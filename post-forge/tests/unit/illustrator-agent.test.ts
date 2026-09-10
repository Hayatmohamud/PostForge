import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { illustrate } from "../../src/agents/illustrator";

const postId = "507f1f77bcf86cd799439011";
const runId = "507f1f77bcf86cd799439012";
const source = { sourceId: "source1", url: "https://example.com/source", title: "Source" };
const article = { title: "A title", body: [{ type: "paragraph" as const, text: "A grounded article.", findingIds: ["finding1"], sourceIds: [] }], citedSources: [source] };
const input = { postId, runId, article, imageConfig: { provider: "gemini", model: "image-model", apiKey: "secret" } };

describe("illustrator agent", () => {
  test("passes a bounded article-derived prompt and returns only a completed poster", async () => {
    const generatePoster = vi.fn().mockResolvedValue({ id: "507f1f77bcf86cd799439013", postId, stage: "illustrate", mediaType: "image/png", byteSize: 10, completedAt: "2026-09-09T10:00:00.000Z" });
    const result = await illustrate(input, { generatePoster });
    expect(result.status).toBe("complete");
    expect(generatePoster).toHaveBeenCalledWith(expect.objectContaining({ postId, runId, prompt: expect.stringContaining("A title") }), undefined);
  });

  test("does not report completion when poster generation fails", async () => {
    await expect(illustrate(input, { generatePoster: vi.fn().mockRejectedValue(new Error("provider failure")) })).rejects.toThrow("provider failure");
  });
});
