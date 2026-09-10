import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ response: "" }));
vi.mock("@inngest/agent-kit", () => ({
  createAgent: (options: Record<string, unknown>) => ({ ...options, run: async () => ({ output: [{ type: "text", role: "assistant", content: fixture.response }] }) }),
}));

import { editArticle } from "../../src/agents/editor";

const source = { sourceId: "source1", url: "https://example.com/source", title: "Source", fetchedEvidence: "Fetched evidence" };
const citation = { sourceId: source.sourceId, url: source.url, title: source.title };
const evidence = { sources: [source], findings: [{ findingId: "finding1", claim: "Supported claim", sourceId: "source1", evidence: "Fetched evidence", verdict: "supported" as const, rationale: "Direct support", corroboratingSourceIds: [] }] };
const article = { title: "Draft", body: [{ type: "paragraph" as const, text: "Supported claim", findingIds: ["finding1"], sourceIds: [] }], citedSources: [citation] };

describe("editor agent", () => {
  beforeEach(() => { fixture.response = ""; });

  test("rejects a draft with no grounded references", async () => {
    await expect(editArticle({ article: { ...article, body: [{ type: "paragraph" as const, text: "New fact", findingIds: [], sourceIds: [] }] }, evidence }, { model: {} as never })).resolves.toEqual({ status: "invalid_output" });
  });

  test("preserves grounded references while deriving current citations", async () => {
    fixture.response = JSON.stringify({ title: "Edited", body: [{ type: "paragraph", text: "Clear supported claim", findingIds: ["finding1"], sourceIds: [] }] });
    await expect(editArticle({ article, evidence }, { model: {} as never })).resolves.toMatchObject({ status: "complete", article: { title: "Edited", citedSources: [citation] } });
  });

  test("rejects fabricated finding references", async () => {
    fixture.response = JSON.stringify({ title: "Edited", body: [{ type: "paragraph", text: "New fact", findingIds: ["finding2"], sourceIds: [] }] });
    await expect(editArticle({ article, evidence }, { model: {} as never })).resolves.toEqual({ status: "invalid_output" });
  });
});
