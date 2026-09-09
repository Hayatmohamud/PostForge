import { describe, expect, test } from "vitest";
import {
  consumeBudget,
  createInitialState,
  deserializeState,
  hasRemainingBudget,
  parseState,
  serializeState,
  transitionState,
} from "../../src/lib/state";
import {
  activateStage,
  completeStage,
  createInitialStages,
  retryStage,
} from "../../src/lib/stages";

const postId = "507f1f77bcf86cd799439011";
const sourceId = "source-1";
const findingId = "finding-1";
const at = "2026-09-09T10:00:00.000Z";
const later = "2026-09-09T10:01:00.000Z";

const configuration = {
  model: { provider: "openrouter", model: "z-ai/glm-5.3-flash" },
  image: { provider: "gemini", model: "gemini-2.5-flash-image" },
};
const budgets = { networkMaxIterations: 6, stageCorrectionAttempts: 1, providerRetries: 1 };

const source = {
  sourceId,
  url: "https://example.com/report",
  title: "Public report",
  fetchedEvidence: "The public report supports the claim.",
  fetchedAt: at,
};
const evidence = {
  sources: [source],
  findings: [{
    findingId,
    claim: "A supported claim",
    sourceId,
    evidence: source.fetchedEvidence,
    verdict: "supported" as const,
    rationale: "The source directly supports the claim.",
    corroboratingSourceIds: [],
  }],
};
const article = {
  title: "Grounded article",
  body: [{ type: "paragraph" as const, text: "An evidence-linked paragraph.", findingIds: [findingId], sourceIds: [sourceId] }],
  citedSources: [{ sourceId, url: source.url, title: source.title }],
};
const image = {
  posterId: "507f1f77bcf86cd799439012",
  gridFsId: "507f1f77bcf86cd799439013",
  postId,
  stage: "illustrate" as const,
  mediaType: "image/png" as const,
  byteSize: 1024,
  completedAt: later,
};

function initial() {
  return createInitialState({ postId, submissionKey: "submission-1", topic: "A bounded topic", configuration, budgets, at });
}

describe("network state lifecycle", () => {
  test("creates a queued state with explicit unstarted stages and safe configuration", () => {
    const state = initial();
    expect(state.status).toBe("queued");
    expect(Object.values(state.stages).every((stage) => stage.status === "queued")).toBe(true);
    expect(state.budgetUsage).toEqual({ networkIterations: 0, stageCorrectionAttempts: 0, providerRetries: 0 });
    expect(JSON.stringify(state)).not.toContain("apiKey");
  });

  test("allows the legal sequential path only when required outputs exist", () => {
    let state = transitionState(initial(), "researching", { at: later });
    state = parseState({ ...state, evidence });
    state = transitionState(state, "verifying", { at: "2026-09-09T10:02:00.000Z" });
    state = transitionState(state, "writing", { at: "2026-09-09T10:03:00.000Z" });
    state = parseState({ ...state, article });
    state = transitionState(state, "editing", { at: "2026-09-09T10:04:00.000Z" });
    state = transitionState(state, "illustrating", { at: "2026-09-09T10:05:00.000Z" });
    state = parseState({ ...state, image });
    state = transitionState(state, "publishing", { at: "2026-09-09T10:06:00.000Z" });
    state = transitionState(state, "done", { at: "2026-09-09T10:07:00.000Z" });
    expect(state.status).toBe("done");
    expect(state.stages.publish.status).toBe("done");
  });

  test("rejects illegal transitions and empty evidence does not imply success", () => {
    expect(() => transitionState(initial(), "writing")).toThrow("Illegal lifecycle transition");
    const researching = transitionState(initial(), "researching", { at: later });
    expect(() => transitionState(researching, "verifying", { at: "2026-09-09T10:02:00.000Z" })).toThrow("evidence");
    const emptyEvidence = parseState({ ...researching, evidence: { sources: [], findings: [] } });
    const verifying = transitionState(emptyEvidence, "verifying", { at: "2026-09-09T10:02:00.000Z" });
    expect(() => transitionState(verifying, "writing", { at: "2026-09-09T10:03:00.000Z" })).toThrow("supported evidence");
  });

  test("requires a safe failure and preserves queued stages after a failed run", () => {
    const failed = transitionState(initial(), "failed", {
      at: later,
      failure: { code: "TERMINAL_FAILURE", message: "The operation could not be completed.", status: 500, retryable: false },
    });
    expect(failed.status).toBe("failed");
    expect(failed.failure?.code).toBe("TERMINAL_FAILURE");
    expect(Object.values(failed.stages).every((stage) => stage.status === "queued")).toBe(true);
    expect(() => transitionState(initial(), "failed")).toThrow();
  });
});

describe("stage and budget guards", () => {
  test("enforces stage transitions and bounded attempts", () => {
    let stages = createInitialStages();
    expect(() => completeStage(stages, "research", at)).toThrow();
    stages = activateStage(stages, "research", at);
    stages = retryStage(stages, "research", later);
    stages = activateStage(stages, "research", "2026-09-09T10:02:00.000Z");
    stages = completeStage(stages, "research", "2026-09-09T10:03:00.000Z");
    expect(stages.research.status).toBe("done");
    expect(() => activateStage(stages, "research")).toThrow();
  });

  test("consumes each finite budget and rejects exhaustion", () => {
    let state = initial();
    expect(hasRemainingBudget(state, "networkIterations")).toBe(true);
    for (let index = 0; index < budgets.networkMaxIterations; index++) state = consumeBudget(state, "networkIterations");
    expect(hasRemainingBudget(state, "networkIterations")).toBe(false);
    expect(() => consumeBudget(state, "networkIterations")).toThrow("exhausted");
    state = consumeBudget(state, "providerRetries");
    expect(() => consumeBudget(state, "providerRetries")).toThrow("exhausted");
  });
});

describe("durable state serialization", () => {
  test("round trips through JSON reconstruction without changing the validated state", () => {
    const state = parseState({ ...initial(), evidence });
    const restored = deserializeState(serializeState(state));
    expect(restored).toEqual(state);
  });

  test("rejects malformed JSON, oversized payloads, and unknown fields", () => {
    expect(() => deserializeState("{not-json")).toThrow();
    expect(() => deserializeState("x".repeat(1_000_001))).toThrow();
    expect(() => parseState({ ...initial(), privateSecret: "do-not-persist" })).toThrow();
  });
});

