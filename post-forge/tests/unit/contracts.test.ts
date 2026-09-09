import { describe, expect, test } from "vitest";
import {
  evidenceBundleSchema,
  findingSchema,
  sourceSchema,
} from "../../src/lib/contracts/evidence";
import {
  articleSchema,
  postSchema,
  stageStateSchema,
} from "../../src/lib/contracts/post";
import { toPostListItem, toPublicPost } from "../../src/lib/contracts/api";

const postId = "507f1f77bcf86cd799439011";
const posterId = "507f1f77bcf86cd799439012";
const gridFsId = "507f1f77bcf86cd799439013";
const createdAt = "2026-09-09T10:00:00.000Z";

const source = {
  sourceId: "source-1",
  url: "https://example.com/report",
  title: "Public report",
  fetchedEvidence: "The report contains the relevant supporting passage.",
  fetchedAt: createdAt,
};

const finding = {
  findingId: "finding-1",
  claim: "A bounded claim supported by the report.",
  sourceId: source.sourceId,
  evidence: source.fetchedEvidence,
  verdict: "supported" as const,
  rationale: "The source directly supports the claim.",
  corroboratingSourceIds: [],
};

const stages = Object.fromEntries(["research", "verify", "write", "edit", "illustrate", "publish"].map((stage) => [stage, {
  status: "done" as const,
  attempts: 1,
  startedAt: createdAt,
  endedAt: "2026-09-09T10:01:00.000Z",
  activity: `${stage} completed`,
}])) as Record<string, unknown>;

const validPost = {
  postId,
  submissionKey: "submission-1",
  topic: "A bounded topic",
  status: "done" as const,
  dispatchState: "dispatched" as const,
  eventId: "507f1f77bcf86cd799439014",
  runId: "507f1f77bcf86cd799439015",
  schemaVersion: 1 as const,
  model: { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
  image: { provider: "gemini", model: "gemini-2.5-flash-image" },
  stages,
  outputs: {
    evidence: { findings: [finding], sources: [source] },
    article: {
      title: "A grounded article",
      body: [{ type: "paragraph" as const, text: "An evidence-linked paragraph.", findingIds: [finding.findingId], sourceIds: [source.sourceId] }],
      citedSources: [{ sourceId: source.sourceId, url: source.url, title: source.title }],
    },
    poster: {
      posterId,
      gridFsId,
      postId,
      stage: "illustrate" as const,
      mediaType: "image/png" as const,
      byteSize: 2048,
      completedAt: "2026-09-09T10:02:00.000Z",
    },
  },
  posterId,
  createdAt,
  updatedAt: "2026-09-09T10:03:00.000Z",
};

describe("evidence contracts", () => {
  test("accepts source-linked supported, unsupported, and conflicting findings", () => {
    const result = evidenceBundleSchema.parse({
      sources: [source],
      findings: [
        finding,
        { ...finding, findingId: "finding-2", verdict: "unsupported", rationale: "The source does not establish this claim." },
        { ...finding, findingId: "finding-3", verdict: "conflicting", rationale: "Sources disagree about this claim." },
      ],
    });
    expect(result.findings.map((item) => item.verdict)).toEqual(["supported", "unsupported", "conflicting"]);
  });

  test("rejects unknown references, duplicate IDs, unsafe URLs, and unknown fields", () => {
    expect(() => evidenceBundleSchema.parse({ sources: [source], findings: [{ ...finding, sourceId: "missing-source" }] })).toThrow();
    expect(() => evidenceBundleSchema.parse({ sources: [source, source], findings: [finding] })).toThrow();
    expect(() => sourceSchema.parse({ ...source, url: "javascript:alert(1)" })).toThrow();
    expect(() => findingSchema.parse({ ...finding, privatePayload: "secret" })).toThrow();
  });

  test("enforces bounded source and evidence text", () => {
    expect(() => sourceSchema.parse({ ...source, fetchedEvidence: "x".repeat(20_001) })).toThrow();
    expect(() => findingSchema.parse({ ...finding, claim: "x".repeat(2_001) })).toThrow();
  });
});

describe("post and article contracts", () => {
  test("accepts a complete post and preserves output identity", () => {
    const parsed = postSchema.parse(validPost);
    expect(parsed.postId).toBe(postId);
    expect(parsed.outputs.poster?.postId).toBe(parsed.postId);
  });

  test("rejects malformed generated IDs, incomplete done output, and oversized topic", () => {
    expect(() => postSchema.parse({ ...validPost, postId: "not-an-id" })).toThrow();
    expect(() => postSchema.parse({ ...validPost, outputs: { evidence: validPost.outputs.evidence }, posterId: undefined })).toThrow();
    expect(() => postSchema.parse({ ...validPost, topic: "x".repeat(2_001) })).toThrow();
  });

  test("requires article citations to be deduplicated and stage timestamps ordered", () => {
    expect(() => articleSchema.parse({ ...validPost.outputs.article, citedSources: [validPost.outputs.article.citedSources[0], validPost.outputs.article.citedSources[0]] })).toThrow();
    expect(() => stageStateSchema.parse({ status: "done", attempts: 1, startedAt: createdAt, endedAt: "2026-09-09T09:59:00.000Z" })).toThrow();
  });
});

describe("browser DTOs", () => {
  test("omit fetched pages, GridFS IDs, model snapshots, and arbitrary secret fields", () => {
    const dto = toPublicPost(validPost);
    expect(dto).not.toHaveProperty("model");
    expect(dto).not.toHaveProperty("image");
    expect(dto.poster).not.toHaveProperty("gridFsId");
    expect(dto.evidence?.findings[0]).not.toHaveProperty("evidence");
    expect(JSON.stringify(dto)).not.toContain("The report contains the relevant supporting passage");
    expect(() => toPublicPost({ ...validPost, apiKey: "secret" } as never)).toThrow();
  });

  test("serializes a safe library item with bounded public fields", () => {
    expect(toPostListItem(validPost)).toEqual({
      postId,
      topic: validPost.topic,
      status: "done",
      posterId,
      createdAt,
      updatedAt: validPost.updatedAt,
    });
  });
});

