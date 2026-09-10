import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { publishPost } from "../../src/agents/publisher";

const postId = "507f1f77bcf86cd799439011";
const runId = "507f1f77bcf86cd799439012";
const source = { sourceId: "source-1", url: "https://example.com/report", title: "Report", fetchedEvidence: "Evidence" };
const evidence = {
  sources: [source],
  findings: [{ findingId: "finding-1", claim: "Claim", sourceId: source.sourceId, evidence: source.fetchedEvidence, verdict: "supported" as const, rationale: "Direct support", corroboratingSourceIds: [] }],
};
const article = {
  title: "Article",
  body: [{ type: "paragraph" as const, text: "Grounded claim", findingIds: ["finding-1"], sourceIds: [] }],
  citedSources: [{ sourceId: source.sourceId, url: source.url, title: source.title }],
};
const poster = {
  id: "507f1f77bcf86cd799439013",
  postId,
  stage: "illustrate" as const,
  mediaType: "image/png" as const,
  byteSize: 1024,
  completedAt: "2026-09-10T12:00:00.000Z",
};
const snapshot = { post: { postId }, revision: 4 } as never;

describe("publisher agent", () => {
  beforeEach(() => vi.restoreAllMocks());

  test("invokes save-post with the current run identity and publishes after confirmation", async () => {
    const savePost = vi.fn().mockResolvedValue(snapshot);
    await expect(publishPost({ postId, runId, revision: 4, article, evidence, poster }, { savePost })).resolves.toEqual({ status: "published", post: snapshot });
    expect(savePost).toHaveBeenCalledWith(expect.objectContaining({ postId, runId, revision: 4, article, evidence, poster: expect.objectContaining({ posterId: poster.id, gridFsId: poster.id }) }), undefined, undefined);
  });

  test("does not persist an incomplete deliverable", async () => {
    const savePost = vi.fn();
    await expect(publishPost({ postId, runId, revision: 4, article, evidence }, { savePost })).resolves.toEqual({ status: "incomplete" });
    expect(savePost).not.toHaveBeenCalled();
  });

  test("reports a database failure without claiming publication", async () => {
    const savePost = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(publishPost({ postId, runId, revision: 4, article, evidence, poster }, { savePost })).resolves.toEqual({ status: "failed" });
  });

  test("returns published for an idempotent repeated save confirmation", async () => {
    const savePost = vi.fn().mockResolvedValue(snapshot);
    const input = { postId, runId, revision: 4, article, evidence, poster };
    await expect(publishPost(input, { savePost })).resolves.toMatchObject({ status: "published" });
    await expect(publishPost(input, { savePost })).resolves.toMatchObject({ status: "published" });
    expect(savePost).toHaveBeenCalledTimes(2);
  });
});
