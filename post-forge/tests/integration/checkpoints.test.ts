import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createInitialState, parseState } from "../../src/lib/state";
import { createMemoryCheckpointStore, safeActivitySummary } from "../../src/agents/checkpoints";
import { runNetwork, type NetworkDependencies } from "../../src/agents/network";

const postId = "507f1f77bcf86cd799439011";
const runId = "507f1f77bcf86cd799439012";
const at = "2026-09-10T12:00:00.000Z";
const configuration = { model: { provider: "openrouter", model: "model" }, image: { provider: "gemini", model: "image-model" } };
const source = { sourceId: "source-1", url: "https://example.com/report", title: "Report", fetchedEvidence: "Direct evidence" };
const finding = { findingId: "finding-1", claim: "Claim", sourceId: source.sourceId, evidence: source.fetchedEvidence, corroboratingSourceIds: [] };
const evidence = { sources: [source], findings: [{ ...finding, verdict: "supported" as const, rationale: "Direct support" }] };
const article = { title: "Article", body: [{ type: "paragraph" as const, text: "Grounded claim", findingIds: [finding.findingId], sourceIds: [] }], citedSources: [{ sourceId: source.sourceId, url: source.url, title: source.title }] };
const poster = { id: "507f1f77bcf86cd799439013", postId, stage: "illustrate" as const, mediaType: "image/png" as const, byteSize: 1024, completedAt: at };
const publishedPost = { post: { postId }, revision: 5 } as never;

function state() {
  return createInitialState({ postId, runId, submissionKey: "submission-1", topic: "A bounded topic", configuration, budgets: { networkMaxIterations: 6, stageCorrectionAttempts: 1, providerRetries: 1 }, at });
}

function dependencies(overrides: Partial<NetworkDependencies> = {}): NetworkDependencies {
  return {
    research: vi.fn().mockResolvedValue({ status: "complete", sources: [source], findings: [finding] }),
    verify: vi.fn().mockResolvedValue({ status: "complete", evidence }),
    writer: vi.fn().mockResolvedValue({ status: "complete", article }),
    editor: vi.fn().mockResolvedValue({ status: "complete", article }),
    illustrator: vi.fn().mockResolvedValue({ status: "complete", poster }),
    publisher: vi.fn().mockResolvedValue({ status: "published", post: publishedPost }),
    imageConfig: () => ({ provider: "gemini", model: "image-model", apiKey: "injected" }),
    now: () => at,
    ...overrides,
  } as NetworkDependencies;
}

describe("network checkpoints", () => {
  test("round-trips validated state with bounded safe activity", async () => {
    const store = createMemoryCheckpointStore();
    const initial = state();
    const saved = await store.save({ state: initial, reason: "start", activity: "Research\u0000 started " + "x".repeat(600) });
    expect(saved?.revision).toBe(0);
    expect(saved?.activity).toHaveLength(500);
    expect(saved?.state).toEqual(parseState(initial));
    await expect(store.load(postId, runId)).resolves.toMatchObject({ revision: 0, state: initial });
    expect(safeActivitySummary("  retrying\nsource lookup  ")).toBe("retrying source lookup");
  });

  test("rejects stale writes and cannot regress completed outputs", async () => {
    const store = createMemoryCheckpointStore();
    const initial = state();
    const first = await store.save({ state: initial, reason: "start" });
    const active = parseState({ ...initial, status: "researching" });
    const second = await store.save({ state: active, expectedRevision: first!.revision, reason: "stage_started" });
    await expect(store.save({ state: initial, expectedRevision: first!.revision, reason: "start" })).resolves.toBeNull();
    const done = parseState({ ...active, status: "done", evidence, article, image: { posterId: poster.id, gridFsId: poster.id, postId, stage: "illustrate", mediaType: "image/png", byteSize: poster.byteSize, completedAt: at } });
    await expect(store.save({ state: done, expectedRevision: second!.revision, reason: "completed" })).resolves.toMatchObject({ state: { status: "done" } });
    await expect(store.save({ state: active, expectedRevision: 2, reason: "stage_started" })).resolves.toBeNull();
  });

  test("persists stage boundaries, outputs, and terminal completion from the network hook", async () => {
    const store = createMemoryCheckpointStore();
    const result = await runNetwork({ state: state(), revision: 2 }, { ...dependencies(), checkpoint: store });
    expect(result.status).toBe("complete");
    const saved = await store.load(postId, runId);
    expect(saved?.state.status).toBe("done");
    expect(saved?.state.evidence).toEqual(evidence);
    expect(saved?.state.article).toEqual(article);
    expect(saved?.state.image?.posterId).toBe(poster.id);
    expect(saved?.reason).toBe("completed");
  });

  test("persists an explicit failure without exposing provider details", async () => {
    const store = createMemoryCheckpointStore();
    const result = await runNetwork(state(), { ...dependencies({ research: vi.fn().mockRejectedValue(new Error("provider-secret")) }), checkpoint: store });
    expect(result.status).toBe("failed");
    const saved = await store.load(postId, runId);
    expect(saved?.state.status).toBe("failed");
    expect(saved?.activity).not.toContain("provider-secret");
  });
});
