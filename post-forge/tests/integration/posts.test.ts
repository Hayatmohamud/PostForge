import { beforeEach, describe, expect, test, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Post } from "../../src/lib/contracts/post";

type Document = Post & { _id: ObjectId; revision: number };
const fixture = vi.hoisted(() => ({
  rows: new Map<string, Document>(), indexes: vi.fn(), collections: vi.fn(), queries: vi.fn(), replaces: vi.fn(),
  failIndexes: false, failRead: false, writeMode: "normal" as "normal" | "duplicate" | "lostAck" | "beforeWrite",
}));
vi.mock("server-only", () => ({}));
vi.mock("../../src/lib/mongo", async () => {
  const { ObjectId: Id } = await import("mongodb");
  const clone = (document: Document): Document => {
    const { _id, ...value } = document;
    return { ...structuredClone(value), _id: new Id(_id.toHexString()) };
  };
  const compare = (left: unknown, right: unknown): number => {
    const a = left instanceof Id ? left.toHexString() : String(left);
    const b = right instanceof Id ? right.toHexString() : String(right);
    return a < b ? -1 : a > b ? 1 : 0;
  };
  const matches = (document: Document, filter: Record<string, unknown>): boolean => Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return (value as Record<string, unknown>[]).some((condition) => matches(document, condition));
    const actual = document[key as keyof Document];
    if (value && typeof value === "object" && "$lt" in value) return compare(actual, value.$lt) < 0;
    return compare(actual, value) === 0;
  });
  const collection = {
    async createIndexes(indexes: unknown) {
      fixture.indexes(indexes);
      if (fixture.failIndexes) throw new Error("fake-db-password index failure");
      return [];
    },
    async findOne(filter: Record<string, unknown>) {
      if (fixture.failRead) throw Object.assign(new Error("fake-db-password read"), { code: "ECONNRESET" });
      const row = [...fixture.rows.values()].find((document) => matches(document, filter));
      return row ? clone(row) : null;
    },
    async findOneAndUpdate(filter: Record<string, unknown>, update: { $setOnInsert: Document }, options: unknown) {
      fixture.queries("upsert", filter, update, options);
      const existing = [...fixture.rows.values()].find((document) => matches(document, filter));
      if (existing) return clone(existing);
      const mode = fixture.writeMode; fixture.writeMode = "normal";
      if (mode === "beforeWrite") throw Object.assign(new Error("fake-db-password unavailable"), { code: "ECONNRESET" });
      const row = clone(update.$setOnInsert);
      fixture.rows.set(row.postId, row);
      if (mode !== "normal") throw Object.assign(new Error("fake-db-password ambiguous"), { code: mode === "duplicate" ? 11000 : "ECONNRESET" });
      return clone(row);
    },
    async findOneAndReplace(filter: Record<string, unknown>, document: Omit<Document, "_id">, options: unknown) {
      fixture.replaces(filter, document, options);
      const previous = [...fixture.rows.values()].find((row) => matches(row, filter));
      if (!previous) return null;
      const replacement = { ...document, _id: previous._id };
      fixture.rows.set(document.postId, clone(replacement));
      return clone(replacement);
    },
    find(filter: Record<string, unknown>) {
      fixture.queries("find", filter);
      let order: Record<string, number> = {}, count = 0;
      const cursor = {
        sort(value: Record<string, number>) { order = value; return cursor; },
        limit(value: number) { count = value; fixture.queries("limit", value); return cursor; },
        async toArray() {
          const rows = [...fixture.rows.values()].filter((row) => matches(row, filter));
          rows.sort((a, b) => {
            for (const [key, direction] of Object.entries(order)) {
              const result = compare(a[key as keyof Document], b[key as keyof Document]) * direction;
              if (result) return result;
            }
            return 0;
          });
          return rows.slice(0, count).map(clone);
        },
      };
      return cursor;
    },
  };
  return { getMongoDatabase: async () => ({
    databaseName: "postforge_test_task012_fixture",
    collection(name: string, options: unknown) { fixture.collections(name, options); return collection; },
  }) };
});

import { AppError } from "../../src/lib/errors";
import {
  checkpointPost, createOrReusePost, finalizePost, getPost, getPublicPost, listPosts,
  SubmissionConflictError, updateDispatch, type PostCheckpoint, type PostSnapshot,
} from "../../src/lib/posts";

const timestamp = "2026-09-09T10:00:00.000Z";
const input = (key = "submission_1") => ({
  submissionKey: key, topic: "An evidence-based topic",
  model: { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
  image: { provider: "gemini", model: "gemini-2.5-flash-image" },
});
const checkpoint = (snapshot: PostSnapshot): PostCheckpoint => structuredClone({
  status: snapshot.post.status, stages: snapshot.post.stages, outputs: snapshot.post.outputs,
});
function completeOutputs(snapshot: PostSnapshot): PostCheckpoint {
  const patch = checkpoint(snapshot);
  patch.status = "publishing";
  for (const name of ["research", "verify", "write", "edit", "illustrate"] as const) {
    patch.stages[name] = { status: "done", attempts: 1, startedAt: timestamp, endedAt: timestamp };
  }
  const source = { sourceId: "source1", url: "https://example.com/research", title: "Research" };
  const posterId = new ObjectId().toHexString();
  patch.outputs = {
    evidence: { sources: [{ ...source, fetchedEvidence: "private fetched page text" }], findings: [{
      findingId: "finding1", claim: "A supported claim", sourceId: source.sourceId, evidence: "private evidence quote",
      verdict: "supported", rationale: "Supported by the source", corroboratingSourceIds: [],
    }] },
    article: { title: "Title", body: [{ type: "paragraph", text: "A supported claim", findingIds: ["finding1"], sourceIds: ["source1"] }], citedSources: [source] },
    poster: { posterId, gridFsId: posterId, postId: snapshot.post.postId, stage: "illustrate", mediaType: "image/png", byteSize: 12, completedAt: timestamp },
  };
  return patch;
}
beforeEach(() => {
  fixture.rows.clear(); fixture.failIndexes = false; fixture.failRead = false; fixture.writeMode = "normal";
  vi.clearAllMocks();
});

describe("post repository (offline MongoDB boundary fixture)", () => {
  test("creates stable queued identity, indexes, snapshots and safe detail", async () => {
    const saved = await createOrReusePost(input());
    expect(saved).toMatchObject({ revision: 0, post: { status: "queued", dispatchState: "queued", schemaVersion: 1, topic: input().topic } });
    expect(saved.post.eventId).toMatch(/^[a-f0-9]{24}$/);
    expect(Object.values(saved.post.stages).every((stage) => stage.status === "queued" && stage.attempts === 0)).toBe(true);
    expect(await getPost(saved.post.postId)).toEqual(saved);
    expect(fixture.indexes).toHaveBeenCalledWith([
      { key: { submissionKey: 1 }, name: "posts_submission_unique", unique: true },
      { key: { eventId: 1 }, name: "posts_event_unique", unique: true },
      { key: { createdAt: -1, _id: -1 }, name: "posts_latest" },
    ]);
    expect(fixture.queries.mock.calls[0][3]).toMatchObject({ upsert: true, returnDocument: "after", includeResultMetadata: false });
    const dto = await getPublicPost(saved.post.postId);
    for (const key of ["_id", "revision", "submissionKey", "eventId", "runId", "dispatchState", "model", "image"]) expect(dto).not.toHaveProperty(key);
  });
  test("same-key retries preserve selections and state while a new key may repeat the topic", async () => {
    const first = await createOrReusePost(input());
    const changed = { ...input(), model: { provider: "other", model: "other-model" } };
    expect(await createOrReusePost(changed)).toEqual(first);
    const second = await createOrReusePost(input("intentional_new"));
    expect(second.post.postId).not.toBe(first.post.postId);
    expect(fixture.rows.size).toBe(2);
  });
  test("same-key/different-topic requests conflict without changing the existing record", async () => {
    const original = await createOrReusePost(input());
    await expect(createOrReusePost({ ...input(), topic: "Other" })).rejects.toBeInstanceOf(SubmissionConflictError);
    expect(await getPost(original.post.postId)).toEqual(original);
  });
  test.each(["duplicate", "lostAck"] as const)("reconciles %s create results by submission identity", async (mode) => {
    fixture.writeMode = mode;
    const saved = await createOrReusePost(input());
    expect(await createOrReusePost(input())).toEqual(saved);
    expect(fixture.rows.size).toBe(1);
  });
  test("concurrent creation yields one record/event ID", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => createOrReusePost(input())));
    expect(new Set(results.map((result) => result.post.postId)).size).toBe(1);
    expect(new Set(results.map((result) => result.post.eventId)).size).toBe(1);
  });
  test("invalid input and malformed identifiers are rejected", async () => {
    await expect(createOrReusePost({ ...input(), topic: " " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createOrReusePost({ ...input(), submissionKey: "$secret" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(getPost("invalid")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await getPost(new ObjectId().toHexString())).toBeNull();
    expect(fixture.rows.size).toBe(0);
  });
  test("index failures prevent unsafe writes and database errors are redacted", async () => {
    fixture.failIndexes = true;
    const indexError = await createOrReusePost(input()).catch((error: unknown) => error);
    expect(String(indexError)).not.toContain("fake-db-password");
    expect(fixture.rows.size).toBe(0);
    fixture.failIndexes = false; fixture.writeMode = "beforeWrite";
    await expect(createOrReusePost(input())).rejects.toMatchObject({ code: "TRANSIENT_FAILURE" });
  });
  test("checkpoints round trip and stale/concurrent writers cannot overwrite progress", async () => {
    const original = await createOrReusePost(input());
    const patch = checkpoint(original); patch.status = "researching";
    patch.stages.research = { status: "active", attempts: 1, startedAt: timestamp };
    const [first, second] = await Promise.all([
      checkpointPost(original.post.postId, 0, patch), checkpointPost(original.post.postId, 0, patch),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second]).toContain(null);
    expect(await getPost(original.post.postId)).toMatchObject({ revision: 1, post: { status: "researching" } });
    expect(await checkpointPost(original.post.postId, 0, checkpoint(original))).toBeNull();
    expect(fixture.replaces.mock.calls[0][0]).toMatchObject({ revision: 0 });
  });
  test("checkpoint arguments are snapshotted before asynchronous work", async () => {
    const original = await createOrReusePost(input());
    const patch = checkpoint(original); patch.status = "researching";
    const result = checkpointPost(original.post.postId, 0, patch);
    patch.status = "failed"; patch.stages.research.attempts = 4;
    expect(await result).toMatchObject({ post: { status: "researching", stages: { research: { attempts: 0 } } } });
  });
  test("dispatch failure recovery preserves event identity and started runs ignore late responses", async () => {
    let saved = await createOrReusePost(input());
    const postId = saved.post.postId, eventId = saved.post.eventId!;
    saved = (await updateDispatch(postId, saved.revision, { state: "failed", eventId }))!;
    expect((await createOrReusePost(input())).post.eventId).toBe(eventId);
    saved = (await updateDispatch(postId, saved.revision, { state: "dispatched", eventId }))!;
    const runId = new ObjectId().toHexString();
    saved = (await updateDispatch(postId, saved.revision, { state: "started", eventId, runId }))!;
    expect(await updateDispatch(postId, saved.revision, { state: "failed", eventId })).toEqual(saved);
    expect(await updateDispatch(postId, saved.revision, { state: "dispatched", eventId })).toEqual(saved);
    expect(await updateDispatch(postId, 0, { state: "failed", eventId })).toBeNull();
    await expect(updateDispatch(postId, saved.revision, { state: "started", eventId, runId: new ObjectId().toHexString() })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(updateDispatch(postId, saved.revision, { state: "failed", eventId: new ObjectId().toHexString() })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  test("completion cannot regress stages, attempts, outputs or overall progress", async () => {
    const original = await createOrReusePost(input());
    const saved = (await checkpointPost(original.post.postId, 0, completeOutputs(original)))!;
    for (const mutation of [
      (patch: PostCheckpoint) => { patch.stages.verify.status = "active"; },
      (patch: PostCheckpoint) => { patch.stages.verify.attempts = 0; },
      (patch: PostCheckpoint) => { patch.outputs.evidence!.findings[0].claim = "Changed"; },
      (patch: PostCheckpoint) => { patch.outputs.article!.title = "Changed"; },
      (patch: PostCheckpoint) => { delete patch.outputs.poster; },
      (patch: PostCheckpoint) => { patch.status = "researching"; },
      (patch: PostCheckpoint) => { patch.status = "done"; },
      (patch: PostCheckpoint) => { patch.stages.publish = { status: "done", attempts: 1, startedAt: timestamp, endedAt: timestamp }; },
    ]) {
      const patch = checkpoint(saved); mutation(patch);
      await expect(checkpointPost(saved.post.postId, saved.revision, patch)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(await getPost(saved.post.postId)).toEqual(saved);
  });
  test("only sanitized diagnostic errors reach persistence or DTOs", async () => {
    const saved = await createOrReusePost(input());
    const patch = checkpoint(saved); patch.status = "failed";
    patch.error = new AppError("TRANSIENT_FAILURE", { cause: new Error("fake-db-password") });
    const failed = await checkpointPost(saved.post.postId, 0, patch);
    expect(JSON.stringify(failed)).not.toContain("fake-db-password");
    const row = fixture.rows.get(saved.post.postId)!;
    row.error!.message = "fake-db-password stored diagnostic";
    const dto = await getPublicPost(saved.post.postId);
    expect(JSON.stringify(dto)).not.toContain("fake-db-password");
    await expect(checkpointPost(saved.post.postId, 1, checkpoint(saved))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  test("requires complete outputs before finalization and publishes exactly once", async () => {
    const original = await createOrReusePost(input());
    await expect(finalizePost(original.post.postId, 0)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const saved = (await checkpointPost(original.post.postId, 0, completeOutputs(original)))!;
    expect(await finalizePost(saved.post.postId, 0)).toBeNull();
    const done = (await finalizePost(saved.post.postId, saved.revision))!;
    expect(done).toMatchObject({ revision: 2, post: { status: "done", stages: { publish: { status: "done" } } } });
    expect(await finalizePost(done.post.postId, 0)).toEqual(done);
    expect((await createOrReusePost(input())).post.status).toBe("done");
    const dto = await getPublicPost(done.post.postId);
    expect(JSON.stringify(dto)).not.toMatch(/private fetched|private evidence|gridFsId|submissionKey|eventId/);
    await expect(checkpointPost(done.post.postId, done.revision, checkpoint(saved))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  test.each(["evidence", "article", "poster"] as const)("missing %s cannot be finalized", async (field) => {
    const original = await createOrReusePost(input());
    const patch = completeOutputs(original); delete patch.outputs[field];
    await expect(checkpointPost(original.post.postId, 0, patch)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await getPost(original.post.postId))!.post.status).toBe("queued");
  });
  test.each(["unsupported", "unknownFinding", "wrongCitation", "differentGridFs"])("rejects invalid finalization: %s", async (mode) => {
    const original = await createOrReusePost(input());
    const patch = completeOutputs(original);
    if (mode === "unsupported") patch.outputs.evidence!.findings[0].verdict = "unsupported";
    if (mode === "unknownFinding") patch.outputs.article!.body[0].findingIds = ["missing"];
    if (mode === "wrongCitation") patch.outputs.article!.citedSources[0].url = "https://example.com/wrong";
    if (mode === "differentGridFs") patch.outputs.poster!.gridFsId = new ObjectId().toHexString();
    const saved = (await checkpointPost(original.post.postId, 0, patch))!;
    await expect(finalizePost(saved.post.postId, saved.revision)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await getPost(saved.post.postId))!.post.status).not.toBe("done");
  });
  test("latest-first pagination has a stable ID tie-breaker with no duplicates", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 7; index++) {
      const saved = await createOrReusePost(input(`submission_${index}`));
      fixture.rows.get(saved.post.postId)!.createdAt = timestamp;
      ids.push(saved.post.postId);
    }
    const collected: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listPosts({ limit: 2, cursor });
      collected.push(...page.posts.map((post) => post.postId)); cursor = page.nextCursor;
      for (const post of page.posts) expect(Object.keys(post).sort()).toEqual(["createdAt", "postId", "status", "topic", "updatedAt"]);
    } while (cursor);
    expect(collected).toEqual(ids.sort().reverse());
    expect(new Set(collected).size).toBe(7);
    expect(fixture.queries).toHaveBeenCalledWith("limit", 3);
  });
  test("pagination uses creation time before ID and remains bounded", async () => {
    const first = await createOrReusePost(input("first"));
    const second = await createOrReusePost(input("second"));
    fixture.rows.get(first.post.postId)!.createdAt = "2026-09-08T10:00:00.000Z";
    fixture.rows.get(second.post.postId)!.createdAt = timestamp;
    expect((await listPosts({ limit: 50 })).posts.map((post) => post.postId)).toEqual([second.post.postId, first.post.postId]);
    for (const limit of [0, -1, 51, 1.5, NaN]) await expect(listPosts({ limit })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const cursor of ["", "invalid!", "a".repeat(257), Buffer.from('{"createdAt":"bad","id":"bad"}').toString("base64url")]) {
      await expect(listPosts({ cursor })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });
  test("empty pages and corrupt persisted documents fail safely", async () => {
    expect(await listPosts()).toEqual({ posts: [] });
    const saved = await createOrReusePost(input());
    fixture.rows.get(saved.post.postId)!.postId = new ObjectId().toHexString();
    await expect(getPublicPost(saved.post.postId)).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
    fixture.failRead = true;
    const error = await getPost(saved.post.postId).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "TRANSIENT_FAILURE" });
    expect(String(error)).not.toContain("fake-db-password");
    expect(error).not.toHaveProperty("cause");
  });
});
