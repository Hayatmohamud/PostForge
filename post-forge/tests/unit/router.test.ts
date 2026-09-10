import { describe, expect, test } from "vitest";

import { createInitialState, parseState } from "../../src/lib/state";
import { routeStage } from "../../src/agents/router";

const postId = "507f1f77bcf86cd799439011";
const at = "2026-09-10T12:00:00.000Z";
const configuration = { model: { provider: "openrouter", model: "model" }, image: { provider: "gemini", model: "image-model" } };
const budgets = { networkMaxIterations: 6, stageCorrectionAttempts: 1, providerRetries: 1 };
const source = { sourceId: "source-1", url: "https://example.com/report", title: "Report", fetchedEvidence: "Evidence" };
const evidence = { sources: [source], findings: [{ findingId: "finding-1", claim: "Claim", sourceId: source.sourceId, evidence: source.fetchedEvidence, verdict: "supported" as const, rationale: "Direct support", corroboratingSourceIds: [] }] };
const article = { title: "Article", body: [{ type: "paragraph" as const, text: "Grounded claim", findingIds: ["finding-1"], sourceIds: [] }], citedSources: [{ sourceId: source.sourceId, url: source.url, title: source.title }] };
const image = { posterId: postId, gridFsId: postId, postId, stage: "illustrate" as const, mediaType: "image/png" as const, byteSize: 1024, completedAt: at };

function initial() { return createInitialState({ postId, submissionKey: "submission-1", topic: "Topic", configuration, budgets, at }); }

describe("stage router", () => {
  test("advances only along the explicit pipeline order", () => {
    expect(routeStage(initial())).toEqual({ status: "advance", nextStatus: "researching", nextStage: "research" });
    expect(routeStage(parseState({ ...initial(), status: "writing" }))).toEqual({ status: "blocked", reason: "Writer output is required before editing." });
    expect(routeStage(parseState({ ...initial(), status: "done", evidence, article, image }))).toMatchObject({ status: "terminal" });
  });

  test("requires supported evidence and non-empty outputs before completion", () => {
    const publishing = parseState({ ...initial(), status: "publishing", evidence: { sources: [source], findings: [] }, article: { ...article, body: [{ ...article.body[0], findingIds: [], sourceIds: [] }] }, image });
    expect(routeStage(publishing)).toMatchObject({ status: "terminal", nextStatus: "failed" });
  });

  test("stops a terminal state and exhausted finite budgets", () => {
    expect(routeStage(parseState({ ...initial(), status: "failed", failure: { code: "TERMINAL_FAILURE", message: "Stopped", status: 500, retryable: false } }))).toMatchObject({ status: "terminal" });
    expect(routeStage(parseState({ ...initial(), budgetUsage: { networkIterations: 6, stageCorrectionAttempts: 0, providerRetries: 0 } }))).toMatchObject({ status: "terminal", nextStatus: "failed" });
    expect(routeStage(parseState({ ...initial(), stages: { ...initial().stages, research: { status: "retrying", attempts: 1, startedAt: at, endedAt: at } }, budgetUsage: { networkIterations: 0, stageCorrectionAttempts: 1, providerRetries: 0 } }))).toMatchObject({ status: "terminal", nextStatus: "failed" });
  });
});
