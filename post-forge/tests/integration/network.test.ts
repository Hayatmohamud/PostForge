import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createInitialState } from "../../src/lib/state";
import { createNetwork, runNetwork, type NetworkDependencies } from "../../src/agents/network";

const postId = "507f1f77bcf86cd799439011";
const runId = "507f1f77bcf86cd799439012";
const at = "2026-09-10T12:00:00.000Z";
const configuration = { model: { provider: "openrouter", model: "model" }, image: { provider: "gemini", model: "image-model" } };
const source = { sourceId: "source-1", url: "https://example.com/report", title: "Report", fetchedEvidence: "Direct evidence" };
const finding = { findingId: "finding-1", claim: "Claim", sourceId: source.sourceId, evidence: source.fetchedEvidence, corroboratingSourceIds: [] };
const verifiedEvidence = { sources: [source], findings: [{ ...finding, verdict: "supported" as const, rationale: "Direct support" }] };
const article = { title: "Article", body: [{ type: "paragraph" as const, text: "Grounded claim", findingIds: [finding.findingId], sourceIds: [] }], citedSources: [{ sourceId: source.sourceId, url: source.url, title: source.title }] };
const poster = { id: "507f1f77bcf86cd799439013", postId, stage: "illustrate" as const, mediaType: "image/png" as const, byteSize: 1024, completedAt: at };
const publishedPost = { post: { postId }, revision: 5 } as never;

function state(overrides: Record<string, unknown> = {}) {
  return createInitialState({ postId, runId, submissionKey: "submission-1", topic: "A bounded topic", configuration, budgets: { networkMaxIterations: 6, stageCorrectionAttempts: 1, providerRetries: 1 }, at, ...overrides });
}

function dependencies(overrides: Partial<NetworkDependencies> = {}): NetworkDependencies {
  return {
    research: vi.fn().mockResolvedValue({ status: "complete", sources: [source], findings: [finding] }),
    verify: vi.fn().mockResolvedValue({ status: "complete", evidence: verifiedEvidence }),
    writer: vi.fn().mockResolvedValue({ status: "complete", article }),
    editor: vi.fn().mockResolvedValue({ status: "complete", article }),
    illustrator: vi.fn().mockResolvedValue({ status: "complete", poster }),
    publisher: vi.fn().mockResolvedValue({ status: "published", post: publishedPost }),
    imageConfig: () => ({ provider: "gemini", model: "image-model", apiKey: "injected" }),
    now: () => at,
    ...overrides,
  } as NetworkDependencies;
}

function mock(value: unknown) {
  return value as ReturnType<typeof vi.fn>;
}

describe("agent network", () => {
  test("runs the six stages in order and propagates validated evidence and outputs", async () => {
    const deps = dependencies();
    const result = await runNetwork({ state: state(), revision: 4 }, deps);
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.state.status).toBe("done");
    expect(result.state.evidence).toEqual(verifiedEvidence);
    expect(result.state.article).toEqual(article);
    expect(result.state.image?.posterId).toBe(poster.id);
    expect(result.state.budgetUsage.networkIterations).toBe(6);
    expect(mock(deps.research)).toHaveBeenCalledBefore(mock(deps.verify));
    expect(mock(deps.verify)).toHaveBeenCalledBefore(mock(deps.writer));
    expect(mock(deps.writer)).toHaveBeenCalledBefore(mock(deps.editor));
    expect(mock(deps.editor)).toHaveBeenCalledBefore(mock(deps.illustrator));
    expect(mock(deps.illustrator)).toHaveBeenCalledBefore(mock(deps.publisher));
    expect(deps.writer!).toHaveBeenCalledWith({ topic: "A bounded topic", evidence: verifiedEvidence }, expect.any(Object));
    expect(deps.publisher!).toHaveBeenCalledWith(expect.objectContaining({ postId, runId, revision: 4, poster: expect.objectContaining({ posterId: poster.id }) }), { env: undefined });
  });

  test("stops on insufficient evidence before Writer and Publisher", async () => {
    const deps = dependencies({ research: vi.fn().mockResolvedValue({ status: "insufficient_evidence", sources: [], findings: [] }) });
    const result = await runNetwork(state(), deps);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.state.failure?.code).toBe("INSUFFICIENT_EVIDENCE");
    expect(deps.writer!).not.toHaveBeenCalled();
    expect(deps.publisher!).not.toHaveBeenCalled();
  });

  test("honors the total iteration bound before starting a run", async () => {
    const bounded = { ...state(), budgetUsage: { networkIterations: 6, stageCorrectionAttempts: 0, providerRetries: 0 } };
    const deps = dependencies();
    const result = await runNetwork(bounded, deps);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.state.failure?.code).toBe("TERMINAL_FAILURE");
    expect(deps.research!).not.toHaveBeenCalled();
  });

  test("factory accepts a saved state runner without embedding model identifiers", async () => {
    const deps = dependencies();
    const runner = createNetwork(deps);
    const result = await runner.run({ state: state(), revision: 2 });
    expect(result.status).toBe("complete");
    expect(deps.research!).toHaveBeenCalledWith("A bounded topic", expect.objectContaining({ selection: configuration.model }));
  });
});
