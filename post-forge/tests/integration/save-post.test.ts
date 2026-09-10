import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { savePost } from "../../src/agents/tools/save-post";
import type { PostSnapshot } from "../../src/lib/posts";

const postId = "507f1f77bcf86cd799439011";
const runId = "507f1f77bcf86cd799439012";
const posterId = "507f1f77bcf86cd799439013";
const source = { sourceId: "source1", url: "https://example.com/source", title: "Source" };
const evidence = { sources: [{ ...source, fetchedEvidence: "Fetched evidence" }], findings: [{
  findingId: "finding1", claim: "A supported claim", sourceId: "source1", evidence: "Direct quote",
  verdict: "supported" as const, rationale: "The source directly supports the claim", corroboratingSourceIds: [],
}] };
const article = { title: "A title", body: [{ type: "paragraph" as const, text: "A supported claim", findingIds: ["finding1"], sourceIds: [] }], citedSources: [] };
const poster = { posterId, gridFsId: posterId, postId, stage: "illustrate" as const, mediaType: "image/png" as const, byteSize: 12, completedAt: "2026-09-09T10:00:00.000Z" };

function snapshot(overrides: Partial<PostSnapshot["post"]> = {}): PostSnapshot {
  return {
    revision: 3,
    post: {
      postId, runId, submissionKey: "submission_1", topic: "Topic", status: "illustrating", dispatchState: "started",
      eventId: "507f1f77bcf86cd799439014", schemaVersion: 1,
      model: { provider: "openrouter", model: "model" }, image: { provider: "gemini", model: "image" },
      stages: {
        research: { status: "done", attempts: 1, startedAt: "2026-09-09T09:00:00.000Z", endedAt: "2026-09-09T09:01:00.000Z" },
        verify: { status: "done", attempts: 1, startedAt: "2026-09-09T09:01:00.000Z", endedAt: "2026-09-09T09:02:00.000Z" },
        write: { status: "done", attempts: 1, startedAt: "2026-09-09T09:02:00.000Z", endedAt: "2026-09-09T09:03:00.000Z" },
        edit: { status: "done", attempts: 1, startedAt: "2026-09-09T09:03:00.000Z", endedAt: "2026-09-09T09:04:00.000Z" },
        illustrate: { status: "done", attempts: 1, startedAt: "2026-09-09T09:04:00.000Z", endedAt: "2026-09-09T09:05:00.000Z" },
        publish: { status: "queued", attempts: 0 },
      },
      outputs: {}, createdAt: "2026-09-09T09:00:00.000Z", updatedAt: "2026-09-09T09:05:00.000Z", ...overrides,
    },
  };
}

const input = { postId, runId, revision: 3, article, evidence, poster };

describe("save-post tool", () => {
  test("persists validated outputs before finalization and derives citations", async () => {
    const current = snapshot();
    const checkpoint = vi.fn().mockResolvedValue({ ...current, revision: 4 });
    const finalize = vi.fn().mockResolvedValue({ ...current, revision: 5, post: { ...current.post, status: "done" } });
    const result = await savePost(input, { getPost: vi.fn().mockResolvedValue(current), checkpointPost: checkpoint, finalizePost: finalize });
    expect(checkpoint).toHaveBeenCalledBefore(finalize);
    expect(checkpoint.mock.calls[0][2]).toMatchObject({ status: "publishing", outputs: { article: { citedSources: [source] } } });
    expect(result.post.status).toBe("done");
  });

  test("returns the existing completed record without rewriting it", async () => {
    const current = snapshot({ status: "done" });
    const checkpoint = vi.fn();
    const result = await savePost(input, { getPost: vi.fn().mockResolvedValue(current), checkpointPost: checkpoint });
    expect(result).toBe(current);
    expect(checkpoint).not.toHaveBeenCalled();
  });

  test.each(["missing", "wrong-run", "bad-source"]) ("rejects %s input", async (mode) => {
    const current = snapshot();
    const value = mode === "missing" ? { ...input, article: { ...article, body: [] } } : mode === "wrong-run" ? { ...input, runId: "507f1f77bcf86cd799439015" } : { ...input, article: { ...article, body: [{ ...article.body[0], sourceIds: ["missing"] }] } };
    await expect(savePost(value, { getPost: vi.fn().mockResolvedValue(current) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
