import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ObjectId } from "mongodb";
import type { Readable } from "node:stream";

type FixtureManifest = {
  _id: string; posterId: ObjectId; postId: string; stage: string; status: string;
  mediaType: string; byteSize: number; sha256: string; completedAt: Date;
};
type FixtureFile = { _id: ObjectId; length: number; metadata: Record<string, unknown>; bytes: Buffer };
const fixture = vi.hoisted(() => ({
  files: new Map<string, FixtureFile>(), manifests: new Map<string, FixtureManifest>(), partial: new Map<string, Buffer>(),
  uploads: vi.fn(), aborts: vi.fn(), deletes: vi.fn(), downloads: vi.fn(), buckets: vi.fn(), collections: vi.fn(), getDb: vi.fn(),
  failUpload: false, failDelete: false, omitFile: false, holdUpload: false, failFind: false,
  insertMode: "normal" as "normal" | "commitThenThrow" | "deferCommit" | "commitThenReadFails",
  delayedManifest: undefined as FixtureManifest | undefined,
  waiters: [] as ((error?: Error) => void)[],
  downloadBytes: undefined as Buffer | undefined, downloadError: false,
  lastDownload: undefined as Readable | undefined,
}));

vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/mongo", () => ({
  getMongoDatabase: async () => {
    fixture.getDb();
    return {
      databaseName: "postforge_test_task007_fixture",
      collection(name: string, options: unknown) {
        fixture.collections(name, options);
        return {
          async findOne(filter: { _id?: string; posterId?: ObjectId; status: string }) {
            if (fixture.failFind) { fixture.failFind = false; throw Object.assign(new Error("fake-secret lookup"), { code: "ECONNRESET" }); }
            const record = filter._id ? fixture.manifests.get(filter._id) : [...fixture.manifests.values()].find((item) => item.posterId.equals(filter.posterId));
            return record?.status === filter.status ? { ...record } : null;
          },
          async insertOne(record: FixtureManifest) {
            if (fixture.manifests.has(record._id)) throw Object.assign(new Error("fake-secret duplicate"), { code: 11000 });
            const mode = fixture.insertMode;
            fixture.insertMode = "normal";
            if (mode === "deferCommit") fixture.delayedManifest = { ...record };
            else fixture.manifests.set(record._id, { ...record });
            if (mode === "commitThenReadFails") fixture.failFind = true;
            if (mode !== "normal") throw Object.assign(new Error("fake-secret ambiguous write"), { code: "ECONNRESET" });
            return { acknowledged: true, insertedId: record._id };
          },
        };
      },
    };
  },
}));

// Actual ObjectId/errors/types and Node streams; no MongoDB sockets or real GridFS.
vi.mock("mongodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongodb")>();
  const { Readable, Writable } = await import("node:stream");
  return {
    ...actual,
    GridFSBucket: class FixtureBucket {
      constructor(db: { databaseName: string }, options: unknown) { fixture.buckets(db.databaseName, options); }
      find(filter: { _id: ObjectId }) {
        return { next: async () => fixture.files.get(filter._id.toHexString()) ?? null };
      }
      openUploadStreamWithId(id: ObjectId, filename: string, options: { metadata: Record<string, unknown>; timeoutMS: number }) {
        fixture.uploads(id, filename, options);
        const key = id.toHexString();
        const stream = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            fixture.partial.set(key, Buffer.concat([fixture.partial.get(key) ?? Buffer.alloc(0), chunk]));
            if (fixture.failUpload) { fixture.failUpload = false; callback(new Error("fake-secret interrupted upload")); }
            else callback();
          },
          final(callback) {
            const complete = (error?: Error) => {
              if (error) { callback(error); return; }
              const bytes = fixture.partial.get(key) ?? Buffer.alloc(0);
              if (!fixture.omitFile) fixture.files.set(key, { _id: id, length: bytes.length, bytes, metadata: { ...options.metadata } });
              fixture.partial.delete(key);
              callback();
            };
            if (fixture.holdUpload) fixture.waiters.push(complete);
            else complete();
          },
        });
        return Object.assign(stream, {
          id,
          async abort() { fixture.aborts(id); fixture.partial.delete(key); },
        });
      }
      async delete(id: ObjectId) {
        fixture.deletes(id);
        if (fixture.failDelete) throw new Error("fake-secret cleanup");
        fixture.files.delete(id.toHexString());
        fixture.partial.delete(id.toHexString());
      }
      openDownloadStream(id: ObjectId, options: unknown) {
        fixture.downloads(id, options);
        const bytes = fixture.downloadBytes ?? fixture.files.get(id.toHexString())!.bytes;
        const stream = Readable.from((async function* () {
          yield bytes.subarray(0, 4);
          if (fixture.downloadError) throw new Error("fake-secret download");
          yield bytes.subarray(4);
        })());
        fixture.lastDownload = stream;
        return stream;
      }
    },
  };
});

import { ObjectId as RealObjectId, ReadPreference } from "mongodb";
import { getPoster, savePoster, type PosterMediaType, type SavePosterInput } from "../../src/lib/poster-storage";

const postId = "507f1f77bcf86cd799439011";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const input = (): SavePosterInput => ({ postId, stage: "illustrate", mediaType: "image/png", bytes: Buffer.from(png) });
const env = (): Record<string, string | undefined> => ({
  OPENROUTER_API_KEY: "fake-text-key", OPENROUTER_MODEL: "z-ai/glm-5.3-flash",
  SERPER_API_KEY: "fake-search-key", GEMINI_API_KEY: "fake-image-key",
  IMAGE_PROVIDER: "gemini", IMAGE_MODEL: "gemini-2.5-flash-image", INNGEST_DEV: "true",
  MONGODB_URI: "mongodb://127.0.0.1:27019", MONGODB_DB: "postforge_test_task007_fixture",
  TEST_MONGODB_URI: "mongodb://127.0.0.1:27019", TEST_MONGODB_DB: "postforge_test_task007_fixture",
  POSTER_MAX_BYTES: "64", DATABASE_TIMEOUT_MS: "1000",
});

beforeEach(() => {
  fixture.files.clear(); fixture.manifests.clear(); fixture.partial.clear();
  fixture.failUpload = false; fixture.failDelete = false; fixture.omitFile = false;
  fixture.holdUpload = false; fixture.failFind = false; fixture.insertMode = "normal";
  fixture.delayedManifest = undefined; fixture.waiters = [];
  fixture.downloadBytes = undefined; fixture.downloadError = false; fixture.lastDownload = undefined;
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("completed poster storage (GridFS boundary fixture)", () => {
  test("round trips bytes with safe completed metadata and explicit association", async () => {
    const poster = await savePoster(input(), env());
    expect(poster).toMatchObject({ postId, stage: "illustrate", mediaType: "image/png", byteSize: png.length });
    expect(Number.isNaN(Date.parse(poster.completedAt))).toBe(false);
    expect(Object.keys(poster).sort()).toEqual(["byteSize", "completedAt", "id", "mediaType", "postId", "stage"]);
    const loaded = await getPoster(poster.id, env());
    expect(loaded).toEqual({ ...poster, bytes: png });
    expect(fixture.collections).toHaveBeenCalledWith("poster_uploads", { readPreference: ReadPreference.primary, writeConcern: { w: "majority" } });
    expect(fixture.buckets).toHaveBeenCalledWith("postforge_test_task007_fixture", {
      bucketName: "posters", timeoutMS: 1000, readPreference: ReadPreference.primary, writeConcern: { w: "majority" },
    });
    expect(fixture.uploads.mock.calls[0][2]).toMatchObject({ timeoutMS: 1000, metadata: { postId, stage: "illustrate", mediaType: "image/png", byteSize: png.length } });
    expect(fixture.downloads.mock.calls[0][1]).toEqual({ timeoutMS: 1000 });
    expect(JSON.stringify(poster)).not.toContain("fake-");
  });

  test.each([
    ["image/png", png],
    ["image/jpeg", Buffer.from([255, 216, 255, 224, 0, 16])],
    ["image/webp", Buffer.from("RIFF1234WEBPfixture")],
  ] as const)("accepts a %s container signature", async (mediaType, bytes) => {
    expect((await savePoster({ ...input(), mediaType, bytes }, env())).mediaType).toBe(mediaType);
  });

  test.each(["text/html", "image/svg+xml", "image/gif", "image/png; secret=abc"])("rejects unsupported MIME %s", async (mediaType) => {
    await expect(savePoster({ ...input(), mediaType: mediaType as PosterMediaType }, env())).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fixture.getDb).not.toHaveBeenCalled();
  });

  test("rejects empty, oversized, and MIME-mismatched bytes before database access", async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(65), Buffer.from("fake-not-image")]) {
      await expect(savePoster({ ...input(), bytes }, env())).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(savePoster({ ...input(), mediaType: "image/jpeg" }, env())).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fixture.getDb).not.toHaveBeenCalled();
  });

  test("enforces the exact configured size boundary", async () => {
    expect((await savePoster(input(), { ...env(), POSTER_MAX_BYTES: String(png.length) })).byteSize).toBe(png.length);
    await expect(savePoster(input(), { ...env(), POSTER_MAX_BYTES: String(png.length - 1) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test.each(["", "post-with-secret", `${postId}\n`])("rejects invalid association %s", async (id) => {
    await expect(savePoster({ ...input(), postId: id }, env())).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("rejects a different stage and normalizes equivalent post IDs", async () => {
    await expect(savePoster({ ...input(), stage: "write" as "illustrate" }, env())).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const first = await savePoster({ ...input(), postId: postId.toUpperCase() }, env());
    expect(await savePoster(input(), env())).toEqual(first);
    expect(fixture.uploads).toHaveBeenCalledTimes(1);
  });

  test("snapshots caller bytes and MIME before asynchronous storage", async () => {
    const mutable = { ...input(), bytes: Buffer.from(png) };
    const pending = savePoster(mutable, env());
    mutable.bytes.fill(0); mutable.mediaType = "image/jpeg";
    const record = await pending;
    expect((await getPoster(record.id, env()))?.bytes).toEqual(png);
    expect(record.mediaType).toBe("image/png");
  });

  test("retries return the completed winner without uploading again", async () => {
    const first = await savePoster(input(), env());
    const changedBytes = Buffer.from(png); changedBytes[8] = 9;
    expect(await savePoster({ ...input(), bytes: changedBytes }, env())).toEqual(first);
    expect(fixture.uploads).toHaveBeenCalledTimes(1);
    expect((await getPoster(first.id, env()))?.bytes).toEqual(png);
  });

  test("concurrent attempts publish one winner and clean only the loser", async () => {
    const [first, second] = await Promise.all([savePoster(input(), env()), savePoster(input(), env())]);
    expect(first).toEqual(second);
    expect(fixture.manifests.size).toBe(1);
    expect(fixture.files.size).toBe(1);
    expect(fixture.deletes).toHaveBeenCalledTimes(1);
    expect(fixture.deletes.mock.calls[0][0].toHexString()).not.toBe(first.id);
    expect((await getPoster(first.id, env()))?.bytes).toEqual(png);
  });

  test("unfinished uploads are never published and interrupted bytes are cleaned", async () => {
    fixture.holdUpload = true;
    const pending = savePoster(input(), env());
    const rejected = expect(pending).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
    await vi.waitFor(() => expect(fixture.waiters).toHaveLength(1));
    const id = fixture.uploads.mock.calls[0][0].toHexString();
    expect(fixture.manifests.size).toBe(0);
    expect(await getPoster(id, env())).toBeNull();
    fixture.waiters[0](new Error("fake-secret interrupted finalization"));
    await rejected;
    expect(fixture.aborts).toHaveBeenCalledTimes(1);
    expect(fixture.partial.size).toBe(0);
    expect(fixture.manifests.size).toBe(0);
  });

  test("an upload error cannot succeed and a new attempt can recover", async () => {
    fixture.failUpload = true;
    await expect(savePoster(input(), env())).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
    expect(fixture.manifests.size).toBe(0);
    expect(fixture.partial.size).toBe(0);
    expect((await savePoster(input(), env())).byteSize).toBe(png.length);
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("fake-secret");
  });

  test("stream finish without a persisted GridFS file cannot publish", async () => {
    fixture.omitFile = true;
    await expect(savePoster(input(), env())).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
    expect(fixture.manifests.size).toBe(0);
    expect(fixture.deletes).toHaveBeenCalledTimes(1);
  });

  test("an acknowledged-after-timeout manifest is reconciled without deleting its file", async () => {
    fixture.insertMode = "commitThenThrow";
    const record = await savePoster(input(), env());
    expect(fixture.deletes).not.toHaveBeenCalled();
    expect((await getPoster(record.id, env()))?.bytes).toEqual(png);
  });

  test("uncertain writes retain their file so a late commit cannot reference deleted bytes", async () => {
    fixture.insertMode = "deferCommit";
    await expect(savePoster(input(), env())).rejects.toMatchObject({ code: "TRANSIENT_FAILURE" });
    const delayed = fixture.delayedManifest!;
    expect(await getPoster(delayed.posterId.toHexString(), env())).toBeNull();
    expect(fixture.files.has(delayed.posterId.toHexString())).toBe(true);
    expect(fixture.deletes).not.toHaveBeenCalled();
    fixture.manifests.set(delayed._id, delayed);
    expect((await savePoster(input(), env())).id).toBe(delayed.posterId.toHexString());
    expect(fixture.uploads).toHaveBeenCalledTimes(1);
  });

  test("failed reconciliation preserves a potentially published file", async () => {
    fixture.insertMode = "commitThenReadFails";
    await expect(savePoster(input(), env())).rejects.toMatchObject({ code: "TRANSIENT_FAILURE" });
    expect(fixture.deletes).not.toHaveBeenCalled();
    const recovered = await savePoster(input(), env());
    expect((await getPoster(recovered.id, env()))?.bytes).toEqual(png);
  });

  test("loser cleanup failure never deletes or replaces the published winner", async () => {
    fixture.failDelete = true;
    const [first, second] = await Promise.all([savePoster(input(), env()), savePoster(input(), env())]);
    expect(first.id).toBe(second.id);
    expect((await getPoster(first.id, env()))?.bytes).toEqual(png);
    expect(fixture.files.size).toBe(2); // Unreferenced loser, not a broken reference.
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("fake-secret");
  });

  test("unknown and orphan IDs are not readable", async () => {
    expect(await getPoster(new RealObjectId().toHexString(), env())).toBeNull();
    await expect(getPoster("bad-id", env())).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("missing or mismatched completed metadata is not exposed", async () => {
    const record = await savePoster(input(), env());
    fixture.files.get(record.id)!.metadata.postId = "000000000000000000000000";
    await expect(getPoster(record.id, env())).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
    await expect(savePoster(input(), env())).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
    fixture.files.delete(record.id);
    await expect(getPoster(record.id, env())).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
  });

  test.each(["truncated", "oversized", "changed", "error"])("rejects %s downloads without returning partial bytes", async (mode) => {
    const record = await savePoster(input(), env());
    if (mode === "truncated") fixture.downloadBytes = png.subarray(0, 8);
    if (mode === "oversized") fixture.downloadBytes = Buffer.concat([png, Buffer.alloc(65)]);
    if (mode === "changed") { fixture.downloadBytes = Buffer.from(png); fixture.downloadBytes[8] = 99; }
    if (mode === "error") fixture.downloadError = true;
    const error = await getPoster(record.id, env()).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "TERMINAL_FAILURE" });
    expect(String(error)).not.toContain("fake-secret");
    expect(error).not.toHaveProperty("cause");
    expect(fixture.lastDownload?.destroyed).toBe(true);
  });
});
