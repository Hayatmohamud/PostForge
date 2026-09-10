import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ response: "" }));
vi.mock("@inngest/agent-kit", () => ({
  createAgent: (options: Record<string, unknown>) => ({ ...options, run: async () => ({ output: [{ type: "text", role: "assistant", content: fixture.response }] }) }),
}));

import { writeArticle } from "../../src/agents/writer";

const source = { sourceId: "source1", url: "https://example.com/source", title: "Source", fetchedEvidence: "Fetched evidence" };
const citation = { sourceId: source.sourceId, url: source.url, title: source.title };
const supported = { findingId: "finding1", claim: "Supported claim", sourceId: "source1", evidence: "Fetched evidence", verdict: "supported" as const, rationale: "Direct support", corroboratingSourceIds: [] };

describe("writer agent", () => {
  beforeEach(() => { fixture.response = ""; });

  test("does not invoke a model without supported evidence", async () => {
    await expect(writeArticle({ topic: "Topic", evidence: { sources: [source], findings: [{ ...supported, verdict: "unsupported" as const }] } })).resolves.toEqual({ status: "insufficient_evidence" });
  });

  test("returns a structured article with derived citations", async () => {
    fixture.response = JSON.stringify({ title: "Title", body: [{ type: "paragraph", text: "Supported claim", findingIds: ["finding1"], sourceIds: [] }] });
    await expect(writeArticle({ topic: "Topic", evidence: { sources: [source], findings: [supported] } }, { model: {} as never })).resolves.toMatchObject({ status: "complete", article: { citedSources: [citation] } });
  });

  test("rejects fabricated finding references", async () => {
    fixture.response = JSON.stringify({ title: "Title", body: [{ type: "paragraph", text: "Unsupported", findingIds: ["finding2"], sourceIds: [] }] });
    await expect(writeArticle({ topic: "Topic", evidence: { sources: [source], findings: [supported] } }, { model: {} as never })).resolves.toEqual({ status: "invalid_output" });
  });
});
