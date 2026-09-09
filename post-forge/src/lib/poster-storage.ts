import "server-only";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  GridFSBucket, MongoNetworkError, MongoOperationTimeoutError, MongoServerSelectionError, ObjectId, ReadPreference,
  type Collection, type Db,
} from "mongodb";
import { getServerConfig } from "./config";
import { AppError, classifyError, sanitizeCorrelation } from "./errors";
import { createLogger } from "./logging";
import { getMongoDatabase } from "./mongo";

export type PosterMediaType = "image/png" | "image/jpeg" | "image/webp";
export type PosterRecord = Readonly<{
  id: string; postId: string; stage: "illustrate"; mediaType: PosterMediaType;
  byteSize: number; completedAt: string;
}>;
export type SavePosterInput = Readonly<{
  postId: string; stage: "illustrate"; mediaType: PosterMediaType; bytes: Uint8Array;
}>;
type Environment = Readonly<Record<string, string | undefined>>;
type Manifest = {
  _id: string; posterId: ObjectId; postId: string; stage: "illustrate";
  mediaType: PosterMediaType; byteSize: number; sha256: string;
  status: "complete"; completedAt: Date;
};
const bucketName = "posters";
const manifestCollection = "poster_uploads";
const log = createLogger();

function safeError(error: unknown): AppError {
  try {
    if (error instanceof MongoNetworkError || error instanceof MongoOperationTimeoutError || error instanceof MongoServerSelectionError) {
      return new AppError("TRANSIENT_FAILURE");
    }
  } catch { /* Do not inspect malformed driver objects further. */ }
  return new AppError(classifyError(error));
}

function matchesMedia(bytes: Buffer, mediaType: unknown): mediaType is PosterMediaType {
  // Verify the declared container signature; full image decoding is outside storage.
  if (mediaType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mediaType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mediaType === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}

function recordOf(manifest: Manifest, maxBytes: number): PosterRecord {
  if (manifest.status !== "complete" || !(manifest.posterId instanceof ObjectId) ||
      sanitizeCorrelation(manifest).postId !== manifest.postId || manifest.stage !== "illustrate" ||
      manifest._id !== `${manifest.postId}:illustrate` ||
      !["image/png", "image/jpeg", "image/webp"].includes(manifest.mediaType) ||
      !Number.isSafeInteger(manifest.byteSize) || manifest.byteSize <= 0 || manifest.byteSize > maxBytes ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      !(manifest.completedAt instanceof Date) || !Number.isFinite(manifest.completedAt.getTime())) {
    throw new AppError("TERMINAL_FAILURE");
  }
  return Object.freeze({
    id: manifest.posterId.toHexString(), postId: manifest.postId, stage: manifest.stage,
    mediaType: manifest.mediaType, byteSize: manifest.byteSize, completedAt: manifest.completedAt.toISOString(),
  });
}

async function verifyFile(bucket: GridFSBucket, manifest: Manifest, maxBytes: number): Promise<PosterRecord> {
  const record = recordOf(manifest, maxBytes);
  const file = await bucket.find({ _id: manifest.posterId }).next();
  if (!file || file.length !== manifest.byteSize || file.metadata?.postId !== manifest.postId ||
      file.metadata?.stage !== manifest.stage || file.metadata?.mediaType !== manifest.mediaType ||
      file.metadata?.sha256 !== manifest.sha256) throw new AppError("TERMINAL_FAILURE");
  return record;
}

async function cleanupAttempt(bucket: GridFSBucket, id: ObjectId, timeoutMS: number): Promise<void> {
  try {
    // Driver 7.6 deletes orphan chunks even when the .files document is absent.
    await bucket.delete(id, { timeoutMS });
  } catch {
    log({ level: "warn", event: "operation.failed", error: new AppError("TERMINAL_FAILURE") });
  }
}

function storage(db: Db, timeoutMS: number) {
  return {
    bucket: new GridFSBucket(db, { bucketName, timeoutMS, readPreference: ReadPreference.primary, writeConcern: { w: "majority" } }),
    manifests: db.collection<Manifest>(manifestCollection, { readPreference: ReadPreference.primary, writeConcern: { w: "majority" } }),
  };
}

/**
 * One completed poster per post/illustrate operation. Each upload gets a fresh
 * GridFS ID; only the first atomic manifest insert publishes a reference.
 * Concurrent losers delete only their own attempt. A crash can leave unreferenced
 * chunks/files, but retries never expose them or replace the completed winner.
 */
export async function savePoster(input: SavePosterInput, env?: Environment): Promise<PosterRecord> {
  const config = getServerConfig(env);
  const maxBytes = config.limits.posterMaxBytes;
  if (!sanitizeCorrelation(input).postId || input.stage !== "illustrate" ||
      !(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytes) {
    throw new AppError("INVALID_INPUT");
  }
  // Snapshot caller-owned bytes before the first await, preventing later mutation.
  const bytes = Buffer.from(input.bytes);
  if (!matchesMedia(bytes, input.mediaType)) throw new AppError("INVALID_INPUT");
  const mediaType = input.mediaType;
  const postId = input.postId.toLowerCase();
  const key = `${postId}:illustrate`;
  try {
    const { bucket, manifests } = storage(await getMongoDatabase(env), config.limits.databaseTimeoutMs);
    const existing = await manifests.findOne({ _id: key, status: "complete" });
    if (existing) return await verifyFile(bucket, existing, maxBytes);
    const id = new ObjectId();
    const manifest: Manifest = {
      _id: key, posterId: id, postId, stage: "illustrate", mediaType,
      byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      status: "complete", completedAt: new Date(),
    };
    const upload = bucket.openUploadStreamWithId(id, `${id.toHexString()}.poster`, {
      metadata: { postId, stage: manifest.stage, mediaType: manifest.mediaType, byteSize: bytes.length, sha256: manifest.sha256 },
      timeoutMS: config.limits.databaseTimeoutMs,
    });
    try {
      await pipeline(Readable.from([bytes]), upload);
      manifest.completedAt = new Date();
      // A stream ending alone is insufficient: the completed GridFS file must exist.
      await verifyFile(bucket, manifest, maxBytes);
    } catch (error) {
      try { await upload.abort(); } catch { /* May already be finished/destroyed. */ }
      await cleanupAttempt(bucket, id, config.limits.databaseTimeoutMs);
      throw error;
    }
    return await publishCompleted(manifests, bucket, manifest, maxBytes, config.limits.databaseTimeoutMs);
  } catch (error) {
    const failure = safeError(error);
    log({ level: "error", event: "operation.failed", correlation: { postId, stage: "illustrate" }, error: failure });
    throw failure;
  }
}

async function publishCompleted(
  manifests: Collection<Manifest>, bucket: GridFSBucket, candidate: Manifest, maxBytes: number, timeoutMS: number,
): Promise<PosterRecord> {
  try {
    // _id's built-in unique index arbitrates across processes, not just this worker.
    await manifests.insertOne(candidate);
    return recordOf(candidate, maxBytes);
  } catch (error) {
    const winner = await manifests.findOne({ _id: candidate._id, status: "complete" });
    if (!winner) {
      // The write could still commit after a timeout. Never delete this file on
      // an uncertain outcome: that would create a broken published reference.
      throw error;
    }
    const record = await verifyFile(bucket, winner, maxBytes);
    if (!winner.posterId.equals(candidate.posterId)) await cleanupAttempt(bucket, candidate.posterId, timeoutMS);
    return record;
  }
}

/** Only canonical completed manifests are readable; partial/orphan IDs return null. */
export async function getPoster(id: string, env?: Environment): Promise<(PosterRecord & { bytes: Buffer }) | null> {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) throw new AppError("INVALID_INPUT");
  const config = getServerConfig(env);
  try {
    const { bucket, manifests } = storage(await getMongoDatabase(env), config.limits.databaseTimeoutMs);
    const manifest = await manifests.findOne({ posterId: new ObjectId(id), status: "complete" });
    if (!manifest) return null;
    const record = await verifyFile(bucket, manifest, config.limits.posterMaxBytes);
    const chunks: Buffer[] = [];
    let byteSize = 0;
    const download = bucket.openDownloadStream(manifest.posterId, { timeoutMS: config.limits.databaseTimeoutMs });
    try {
      for await (const chunk of download) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteSize += bytes.length;
        if (byteSize > record.byteSize || byteSize > config.limits.posterMaxBytes) throw new AppError("TERMINAL_FAILURE");
        chunks.push(bytes);
      }
    } finally {
      download.destroy();
    }
    const bytes = Buffer.concat(chunks, byteSize);
    if (byteSize !== record.byteSize || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256 ||
        !matchesMedia(bytes, record.mediaType)) throw new AppError("TERMINAL_FAILURE");
    return { ...record, bytes };
  } catch (error) {
    throw safeError(error);
  }
}
