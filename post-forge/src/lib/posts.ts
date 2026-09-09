import "server-only";
import { isDeepStrictEqual } from "node:util";
import {
  MongoNetworkError, MongoOperationTimeoutError, MongoServerSelectionError, ObjectId,
  ReadPreference, type Collection, type Filter,
} from "mongodb";
import { getMongoDatabase } from "./mongo";
import { ensurePostIndexes, POSTS_COLLECTION } from "./post-indexes";
import { AppError, classifyError, toPublicError } from "./errors";
import {
  imageSnapshotSchema, modelSnapshotSchema, postCreateSchema, postSchema, stageNameSchema,
  type ImageSnapshot, type ModelSnapshot, type Post, type PostCreate,
} from "./contracts/post";
import { generatedIdSchema } from "./contracts/evidence";
import { API_LIMITS, toPostListItem, toPublicPost, type PostDetailDto, type PostsResponse } from "./contracts/api";

type Environment = Readonly<Record<string, string | undefined>>;
type PostDocument = Post & { _id: ObjectId; revision: number };
export type PostSnapshot = Readonly<{ post: Post; revision: number }>;
export type CreatePostInput = PostCreate & { model: ModelSnapshot; image: ImageSnapshot };
export type PostCheckpoint = Pick<Post, "status" | "stages" | "outputs"> & { error?: unknown };
export type DispatchUpdate =
  | { state: "dispatched" | "failed"; eventId: string }
  | { state: "started"; eventId: string; runId: string };

/** Callers may map this specific input conflict to HTTP 409. No submitted text is attached. */
export class SubmissionConflictError extends AppError {
  constructor() { super("INVALID_INPUT"); }
}

function invalid(): never { throw new AppError("INVALID_INPUT"); }
function parsePost(value: unknown, input = false): Post {
  const parsed = postSchema.safeParse(value);
  if (!parsed.success) throw new AppError(input ? "INVALID_INPUT" : "TERMINAL_FAILURE");
  return parsed.data;
}
function objectId(value: string): ObjectId {
  if (typeof value !== "string" || !/^[a-f0-9]{24}$/i.test(value)) invalid();
  return new ObjectId(value);
}
function revision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) invalid();
}
function snapshot(document: PostDocument): PostSnapshot {
  const { _id, revision: version, ...value } = document;
  if (!(_id instanceof ObjectId) || !Number.isSafeInteger(version) || version < 0 ||
      value.postId !== _id.toHexString() || !value.eventId ||
      new Date(value.createdAt).toISOString() !== value.createdAt) throw new AppError("TERMINAL_FAILURE");
  const post = parsePost(value);
  // Even persisted diagnostic messages are reconstructed from the safe catalog.
  if (post.error) post.error = toPublicError(new AppError(post.error.code), { postId: post.postId, stage: post.error.stage });
  return { post, revision: version };
}
async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof SubmissionConflictError) throw error;
    if (error instanceof MongoNetworkError || error instanceof MongoOperationTimeoutError || error instanceof MongoServerSelectionError) {
      throw new AppError("TRANSIENT_FAILURE");
    }
    throw new AppError(classifyError(error));
  }
}
async function collection(env?: Environment): Promise<Collection<PostDocument>> {
  const db = await getMongoDatabase(env);
  // Idempotent server operation: every entry point fails closed if indexes cannot be ensured.
  await ensurePostIndexes(db);
  return db.collection<PostDocument>(POSTS_COLLECTION, { readPreference: ReadPreference.primary, writeConcern: { w: "majority" } });
}

/** A key identifies an intent, not a topic: deliberate new keys may repeat topics. */
export async function createOrReusePost(input: CreatePostInput, env?: Environment): Promise<PostSnapshot> {
  const request = postCreateSchema.safeParse({ topic: input.topic, submissionKey: input.submissionKey });
  const model = modelSnapshotSchema.safeParse(input.model);
  const image = imageSnapshotSchema.safeParse(input.image);
  if (!request.success || !model.success || !image.success) invalid();
  const _id = new ObjectId();
  const now = new Date().toISOString();
  const stages = Object.fromEntries(stageNameSchema.options.map((stage) => [stage, { status: "queued", attempts: 0 }]));
  const post = parsePost({
    ...request.data, postId: _id.toHexString(), eventId: new ObjectId().toHexString(),
    status: "queued", dispatchState: "queued", schemaVersion: 1, model: model.data, image: image.data,
    stages, outputs: {}, createdAt: now, updatedAt: now,
  }, true);
  return safely(async () => {
    const posts = await collection(env);
    let document: PostDocument | null;
    try {
      document = await posts.findOneAndUpdate({ submissionKey: post.submissionKey },
        { $setOnInsert: { ...post, _id, revision: 0 } },
        { upsert: true, returnDocument: "after", includeResultMetadata: false });
    } catch (error) {
      // A competing unique-key insert or lost acknowledgement may already have persisted the intent.
      document = await posts.findOne({ submissionKey: post.submissionKey });
      if (!document) throw error;
    }
    if (!document) throw new AppError("TERMINAL_FAILURE");
    const current = snapshot(document);
    if (current.post.topic !== post.topic) throw new SubmissionConflictError();
    return current; // Preserve original snapshots/event ID/progress on every retry.
  });
}

/** Internal server snapshot; browser entry points must use getPublicPost instead. */
export async function getPost(postId: string, env?: Environment): Promise<PostSnapshot | null> {
  const _id = objectId(postId);
  return safely(async () => {
    const document = await (await collection(env)).findOne({ _id });
    return document ? snapshot(document) : null;
  });
}
export async function getPublicPost(postId: string, env?: Environment): Promise<PostDetailDto | null> {
  const result = await getPost(postId, env);
  return result ? toPublicPost(result.post) : null;
}

async function compareAndSwap(
  posts: Collection<PostDocument>, current: PostSnapshot, next: Post,
): Promise<PostSnapshot | null> {
  const _id = objectId(current.post.postId);
  const post = parsePost({ ...next, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.post.updatedAt))).toISOString() }, true);
  const result = await posts.findOneAndReplace({ _id, revision: current.revision },
    { ...post, revision: current.revision + 1 }, { returnDocument: "after", includeResultMetadata: false });
  return result ? snapshot(result) : null;
}

/** Null means missing/stale: reload and recompute; never blindly replay an old snapshot. */
export async function updateDispatch(
  postId: string, expectedRevision: number, update: DispatchUpdate, env?: Environment,
): Promise<PostSnapshot | null> {
  const _id = objectId(postId); revision(expectedRevision);
  const change = { ...update }; // Snapshot arguments before asynchronous work.
  if (!["dispatched", "started", "failed"].includes(change.state) || !generatedIdSchema.safeParse(change.eventId).success ||
      (change.state === "started" && !generatedIdSchema.safeParse(change.runId).success)) invalid();
  return safely(async () => {
    const posts = await collection(env);
    const document = await posts.findOne({ _id });
    if (!document) return null;
    const current = snapshot(document);
    if (current.revision !== expectedRevision) return null;
    if (current.post.eventId !== change.eventId) invalid();
    const post = current.post;
    // A late acknowledgement/failure cannot reset a workflow that already started.
    if (post.dispatchState === "started") {
      if (change.state === "started" && post.runId !== change.runId) invalid();
      return current;
    }
    if (post.dispatchState === "dispatched" && change.state === "failed") return current;
    if (post.dispatchState === change.state) return current;
    if (post.status === "done" || post.status === "failed") return current;
    return compareAndSwap(posts, current, { ...post, dispatchState: change.state,
      ...(change.state === "started" ? { runId: change.runId } : {}) });
  });
}

const progress: Post["status"][] = ["queued", "researching", "verifying", "writing", "editing", "illustrating", "publishing", "done"];
function guardCheckpoint(before: Post, after: Post): void {
  if (after.status === "done" || after.stages.publish.status === "done" || before.status === "done" || before.status === "failed" ||
      (after.status !== "failed" && progress.indexOf(after.status) < progress.indexOf(before.status))) invalid();
  for (const name of stageNameSchema.options) {
    const old = before.stages[name], next = after.stages[name];
    if (next.attempts < old.attempts ||
        (old.status !== "queued" && next.status === "queued") ||
        ((old.status === "done" || old.status === "failed") && !isDeepStrictEqual(old, next)) ||
        (next.status === "done" && (!next.startedAt || !next.endedAt || next.attempts < 1))) invalid();
  }
  for (const [stage, output] of [["verify", "evidence"], ["edit", "article"], ["illustrate", "poster"]] as const) {
    if (before.stages[stage].status === "done" && !isDeepStrictEqual(before.outputs[output], after.outputs[output])) invalid();
    if (after.stages[stage].status === "done" && !after.outputs[output]) invalid();
  }
}
export async function checkpointPost(
  postId: string, expectedRevision: number, checkpoint: PostCheckpoint, env?: Environment,
): Promise<PostSnapshot | null> {
  const _id = objectId(postId); revision(expectedRevision);
  // Clone structured content before awaiting; schema validation below supplies bounded shapes.
  let patch: PostCheckpoint;
  try {
    patch = structuredClone({ status: checkpoint.status, stages: checkpoint.stages, outputs: checkpoint.outputs });
  } catch { invalid(); }
  const failure = checkpoint.error === undefined ? undefined : toPublicError(checkpoint.error, { postId: _id.toHexString() });
  return safely(async () => {
    const posts = await collection(env);
    const document = await posts.findOne({ _id });
    if (!document) return null;
    const current = snapshot(document);
    if (current.revision !== expectedRevision) return null;
    const next = parsePost({ ...current.post, ...patch, error: failure,
      posterId: patch.outputs.poster?.posterId }, true);
    guardCheckpoint(current.post, next);
    return compareAndSwap(posts, current, next);
  });
}

function guardFinalization(post: Post): void {
  const { article, evidence, poster } = post.outputs;
  if (!article || !evidence || !poster || post.status === "failed" || post.stages.publish.status === "failed" ||
      stageNameSchema.options.slice(0, -1).some((stage) => post.stages[stage].status !== "done") ||
      poster.gridFsId !== poster.posterId || poster.postId !== post.postId) invalid();
  const findings = new Map(evidence.findings.map((finding) => [finding.findingId, finding]));
  const sources = new Map(evidence.sources.map((source) => [source.sourceId, source]));
  const used = new Set<string>();
  let supported = false;
  for (const block of article.body) {
    for (const id of block.findingIds) {
      const finding = findings.get(id);
      if (!finding || finding.verdict !== "supported") invalid();
      supported = true; used.add(finding.sourceId);
    }
    for (const id of block.sourceIds) { if (!sources.has(id)) invalid(); used.add(id); }
  }
  if (!supported || article.citedSources.length !== used.size) invalid();
  for (const citation of article.citedSources) {
    const source = sources.get(citation.sourceId);
    if (!used.has(citation.sourceId) || !source || citation.url !== source.url || citation.title !== source.title) invalid();
  }
}

/** Finalizes saved outputs only. Tools supply a completed storage reference, never raw image bytes. */
export async function finalizePost(postId: string, expectedRevision: number, env?: Environment): Promise<PostSnapshot | null> {
  const _id = objectId(postId); revision(expectedRevision);
  return safely(async () => {
    const posts = await collection(env);
    const document = await posts.findOne({ _id });
    if (!document) return null;
    const current = snapshot(document);
    if (current.post.status === "done") return current; // A retried finalization returns the existing identity.
    if (current.revision !== expectedRevision) return null;
    guardFinalization(current.post);
    const now = new Date(Math.max(Date.now(), Date.parse(current.post.updatedAt))).toISOString();
    const publish = current.post.stages.publish;
    const next: Post = { ...current.post, status: "done", posterId: current.post.outputs.poster!.posterId, error: undefined,
      stages: { ...current.post.stages, publish: { ...publish, status: "done", attempts: Math.max(1, publish.attempts),
        startedAt: publish.startedAt ?? now, endedAt: now } } };
    return compareAndSwap(posts, current, next);
  });
}

type Cursor = { createdAt: string; id: string };
function decodeCursor(value: string): Cursor {
  if (typeof value !== "string" || !value.length || value.length > API_LIMITS.maxCursorChars || !/^[\w-]+$/.test(value)) invalid();
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (!decoded || Object.keys(decoded).sort().join(",") !== "createdAt,id" ||
        typeof decoded.createdAt !== "string" || new Date(decoded.createdAt).toISOString() !== decoded.createdAt) invalid();
    objectId(decoded.id);
    return decoded;
  } catch { invalid(); }
}
export async function listPosts(options: { limit?: number; cursor?: string } = {}, env?: Environment): Promise<PostsResponse> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > API_LIMITS.maxPageSize) invalid();
  const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  return safely(async () => {
    const filter: Filter<PostDocument> = cursor ? { $or: [
      { createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $lt: objectId(cursor.id) } },
    ] } : {};
    const rows = await (await collection(env)).find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
    const visible = rows.slice(0, limit).map(snapshot);
    const last = visible.at(-1);
    return { posts: visible.map(({ post }) => toPostListItem(post)),
      ...(rows.length > limit && last ? { nextCursor: Buffer.from(JSON.stringify({
        createdAt: last.post.createdAt, id: last.post.postId,
      })).toString("base64url") } : {}) };
  });
}
