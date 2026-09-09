import { beforeEach, describe, expect, test, vi } from "vitest";
import { ObjectId } from "mongodb";
import { postStatusSchema, type Post } from "../../src/lib/contracts/post";
import { errorResponseSchema, postResponseSchema } from "../../src/lib/contracts/api";

type StoredPost = Post & { _id: ObjectId; revision: number };
const fixture = vi.hoisted(() => ({
  document: null as StoredPost | null, error: undefined as unknown,
  reads: vi.fn(), indexes: vi.fn(), connections: vi.fn(),
}));
vi.mock("server-only", () => ({}));
// Keep the actual repository and shared DTO projection in this integration path.
// The database boundary is entirely offline and never selects an application DB.
vi.mock("../../src/lib/mongo", () => ({ getMongoDatabase: async () => {
  fixture.connections();
  if (fixture.error !== undefined) throw fixture.error;
  return {
    databaseName: "postforge_test_task032_fixture",
    collection() { return {
      createIndexes: async () => { fixture.indexes(); },
      findOne: async (filter: { _id: ObjectId }) => {
        fixture.reads(filter);
        return fixture.document?._id.equals(filter._id) ? fixture.document : null;
      },
    }; },
  };
} }));

import { GET, dynamic, runtime } from "../../src/app/api/posts/[id]/route";
import { AppError } from "../../src/lib/errors";

const id = "507f1f77bcf86cd799439011";
const timestamp = "2026-09-09T10:00:00.000Z";
function stored(status: Post["status"] = "queued"): StoredPost {
  const source = { sourceId: "source1", url: "https://example.com/research", title: "Research" };
  const posterId = "507f1f77bcf86cd799439022";
  return {
    _id: new ObjectId(id), postId: id, revision: 3, submissionKey: "private_submission_key",
    eventId: "507f1f77bcf86cd799439012", runId: "507f1f77bcf86cd799439013",
    topic: "A researched topic", status, dispatchState: "started", schemaVersion: 1,
    model: { provider: "private-provider", model: "private-model" }, image: { provider: "private-image-provider", model: "private-image-model" },
    stages: {
      research: { status: "done", attempts: 1, startedAt: timestamp, endedAt: timestamp, activity: "Found sources" },
      verify: { status: "retrying", attempts: 2, startedAt: timestamp, activity: "Checking conflicting claims" },
      write: { status: "queued", attempts: 0 }, edit: { status: "queued", attempts: 0 },
      illustrate: { status: "queued", attempts: 0 }, publish: { status: "queued", attempts: 0 },
    },
    outputs: {
      evidence: {
        sources: [{ ...source, fetchedEvidence: "RAW_PAGE_FAKE_SECRET" }],
        findings: [
          { findingId: "finding1", claim: "Supported claim", sourceId: "source1", evidence: "RAW_QUOTE_FAKE_SECRET", verdict: "supported", rationale: "Directly supported", corroboratingSourceIds: [] },
          { findingId: "finding2", claim: "Conflicting claim", sourceId: "source1", evidence: "RAW_QUOTE_FAKE_SECRET", verdict: "conflicting", rationale: "Conflicts with evidence", corroboratingSourceIds: [] },
          { findingId: "finding3", claim: "Unsupported claim", sourceId: "source1", evidence: "RAW_QUOTE_FAKE_SECRET", verdict: "unsupported", rationale: "Not supported", corroboratingSourceIds: [] },
        ],
      },
      article: { title: "Article", body: [{ type: "paragraph", text: "Supported claim", findingIds: ["finding1"], sourceIds: ["source1"] }], citedSources: [source] },
      poster: { posterId, gridFsId: posterId, postId: id, stage: "illustrate", mediaType: "image/png", byteSize: 12, completedAt: timestamp },
    },
    posterId, createdAt: timestamp, updatedAt: timestamp,
    ...(status === "failed" ? { error: { code: "TERMINAL_FAILURE" as const, message: "FAKE_CREDENTIAL_IN_STORED_ERROR", status: 500, retryable: false, stage: "verify" as const } } : {}),
  };
}
const request = () => new Request(`http://localhost/api/posts/${id}`);
const call = (value: string = id) => GET(request(), { params: Promise.resolve({ id: value }) });
function expectNoCache(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-type")).toContain("application/json");
}
beforeEach(() => { fixture.document = null; fixture.error = undefined; vi.clearAllMocks(); });

describe("GET /api/posts/[id] (offline repository integration)", () => {
  test.each(postStatusSchema.options)("returns the actual %s snapshot and shared DTO", async (status) => {
    fixture.document = stored(status);
    const response = await call();
    expect(response.status).toBe(200); expectNoCache(response);
    const body = postResponseSchema.parse(await response.json());
    expect(body.post.status).toBe(status);
    expect(body.post.stages).toEqual(fixture.document.stages);
    expect(body.post.evidence!.findings.map((finding) => finding.verdict)).toEqual(["supported", "conflicting", "unsupported"]);
    expect(body.post.evidence!.sources[0]).toEqual({ sourceId: "source1", url: "https://example.com/research", title: "Research" });
    expect(fixture.reads).toHaveBeenCalledTimes(1);
  });
  test("omits unavailable outputs without fabricating evidence or progress", async () => {
    fixture.document = stored("queued"); fixture.document.outputs = {}; delete fixture.document.posterId;
    for (const stage of Object.values(fixture.document.stages)) { stage.status = "queued"; stage.attempts = 0; delete stage.startedAt; delete stage.endedAt; delete stage.activity; }
    const body = postResponseSchema.parse(await (await call()).json());
    expect(body.post).not.toHaveProperty("evidence"); expect(body.post).not.toHaveProperty("article"); expect(body.post).not.toHaveProperty("poster");
    expect(Object.values(body.post.stages).every((stage) => stage.status === "queued" && stage.attempts === 0)).toBe(true);
  });
  test.each(["", "bad-id", "0".repeat(23), "0".repeat(25), "g".repeat(24), `${id}\n`, ` ${id}`, "507f1f77-bcf8-4cd7-9943-901100000000"])("rejects invalid ID %j before database work", async (value) => {
    const response = await call(value);
    expect(response.status).toBe(400); expectNoCache(response);
    expect(errorResponseSchema.parse(await response.json()).error).toMatchObject({ code: "INVALID_INPUT", status: 400, retryable: false });
    expect(fixture.connections).not.toHaveBeenCalled();
  });
  test.each([{ value: undefined }, { value: null }, { value: 42 }, { value: [id] }])("rejects non-string route ID $value", async ({ value }) => {
    const response = await GET(request(), { params: Promise.resolve({ id: value as unknown as string }) });
    expect(response.status).toBe(400);
    expect(fixture.connections).not.toHaveBeenCalled();
  });
  test("normalizes uppercase IDs and returns 404 for a well-formed absent post", async () => {
    fixture.document = stored();
    expect((await call(id.toUpperCase())).status).toBe(200);
    fixture.document = null;
    const response = await call();
    expect(response.status).toBe(404); expectNoCache(response);
    expect(errorResponseSchema.parse(await response.json()).error).toEqual({ code: "INVALID_INPUT", message: "Post not found.", status: 404, retryable: false, postId: id });
  });
  test.each([
    [new AppError("TRANSIENT_FAILURE", { cause: new Error("FAKE_DB_CREDENTIAL") }), 503, "TRANSIENT_FAILURE"],
    [Object.assign(new Error("FAKE_DB_CREDENTIAL"), { code: "ECONNRESET" }), 503, "TRANSIENT_FAILURE"],
    [new Error("FAKE_DB_CREDENTIAL"), 500, "TERMINAL_FAILURE"],
    [new AppError("CONFIGURATION_ERROR"), 500, "CONFIGURATION_ERROR"],
    [new AppError("INVALID_INPUT"), 500, "TERMINAL_FAILURE"],
  ] as const)("sanitizes repository failure %#", async (error, status, code) => {
    fixture.error = error;
    const response = await call();
    expect(response.status).toBe(status); expectNoCache(response);
    const body = await response.json();
    expect(errorResponseSchema.parse(body).error).toMatchObject({ code, status, postId: id });
    expect(JSON.stringify(body)).not.toMatch(/FAKE_DB_CREDENTIAL|cause|stack/);
  });
  test("sanitizes rejected route parameters", async () => {
    const response = await GET(request(), { params: Promise.reject(new Error("FAKE_ROUTE_SECRET")) });
    expect(response.status).toBe(500); expectNoCache(response);
    expect(JSON.stringify(await response.json())).not.toContain("FAKE_ROUTE_SECRET");
    expect(fixture.connections).not.toHaveBeenCalled();
  });
  test("omits raw pages, private identities, provider selections and persisted error messages", async () => {
    fixture.document = stored("failed");
    const response = await call();
    const body = postResponseSchema.parse(await response.json());
    expect(JSON.stringify(body)).not.toMatch(/RAW_PAGE|RAW_QUOTE|FAKE_CREDENTIAL|private_|private-|gridFsId|revision|schemaVersion|dispatchState|runId|eventId|submissionKey/);
    expect(body.post.error).toMatchObject({ code: "TERMINAL_FAILURE", message: "The operation could not be completed.", postId: id, stage: "verify" });
  });
  test("repeated polls observe new repository state and never return a conditional stale response", async () => {
    expect(dynamic).toBe("force-dynamic"); expect(runtime).toBe("nodejs");
    fixture.document = stored("verifying");
    const first = await call(); expectNoCache(first);
    const before = postResponseSchema.parse(await first.json());
    fixture.document.status = "writing";
    fixture.document.stages.verify = { status: "done", attempts: 2, startedAt: timestamp, endedAt: "2026-09-09T10:01:00.000Z" };
    fixture.document.stages.write = { status: "active", attempts: 1, startedAt: "2026-09-09T10:01:00.000Z", activity: "Drafting article" };
    fixture.document.updatedAt = "2026-09-09T10:01:00.000Z";
    const second = await GET(new Request(`http://localhost/api/posts/${id}`, { headers: { "If-None-Match": '"old"', "If-Modified-Since": timestamp } }), { params: Promise.resolve({ id }) });
    expect(second.status).toBe(200); expectNoCache(second);
    const after = postResponseSchema.parse(await second.json());
    expect(before.post.status).toBe("verifying"); expect(after.post.status).toBe("writing");
    expect(after.post.stages.write.activity).toBe("Drafting article"); expect(after.post.updatedAt).not.toBe(before.post.updatedAt);
    expect(fixture.reads).toHaveBeenCalledTimes(2);
  });
  test("an invalid persisted document produces a safe server failure instead of a partial DTO", async () => {
    fixture.document = stored(); fixture.document.postId = "invalid-private-value";
    const response = await call();
    expect(response.status).toBe(500); expectNoCache(response);
    const body = await response.json();
    expect(body).not.toHaveProperty("post"); expect(JSON.stringify(body)).not.toContain("invalid-private-value");
  });
});
