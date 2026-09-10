import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGeneratePostFunction, runGenerationWorkflow, type WorkflowStep } from "../../src/inngest/generate-post";
import { reconcileWorkflowFailure } from "../../src/inngest/failure-handler";
import { GENERATION_REQUESTED_EVENT } from "../../src/inngest/events";
import { AppError, toPublicError } from "../../src/lib/errors";
import { postSchema, type Post } from "../../src/lib/contracts/post";
import { createInitialStages, transitionStage } from "../../src/lib/stages";
import type { NetworkState } from "../../src/lib/state";
import type { InngestClient } from "../../src/inngest/client";
import type { PostSnapshot } from "../../src/lib/posts";

const postId = "507f1f77bcf86cd799439021";
const eventId = "507f1f77bcf86cd799439022";
const at = "2026-09-10T12:00:00.000Z";
const model = { provider: "openrouter", model: "model" };
const image = { provider: "gemini", model: "image-model" };

function makePost(overrides: Partial<Post> = {}): PostSnapshot {
  return {
    revision: 0,
    post: postSchema.parse({
      postId,
      submissionKey: "submission_recovery",
      topic: "A recovery topic",
      status: "queued",
      dispatchState: "started",
      eventId,
      runId: eventId,
      schemaVersion: 1,
      model,
      image,
      stages: createInitialStages(),
      outputs: {},
      createdAt: at,
      updatedAt: at,
      ...overrides,
    }),
  };
}

function event() {
  return { name: GENERATION_REQUESTED_EVENT, data: { postId, eventId } } as const;
}

function step(): WorkflowStep {
  return { run: async <T>(_name: string, handler: () => Promise<T> | T) => handler() };
}

describe("workflow retry and recovery", () => {
  test("retries terminal failure persistence with bounded backoff and fails the active stage", async () => {
    const stages = transitionStage(createInitialStages(), "research", "active", at);
    let current = makePost({ status: "researching", stages });
    const getPost = vi.fn(async () => current);
    const sleep = vi.fn(async () => undefined);
    let attempts = 0;
    const checkpointPost = vi.fn(async (_id: string, _revision: number, checkpoint: { status: Post["status"]; stages: Post["stages"]; outputs: Post["outputs"]; error?: unknown }) => {
      attempts += 1;
      if (attempts < 3) return null;
      current = { revision: current.revision + 1, post: postSchema.parse({ ...current.post, ...checkpoint, updatedAt: at }) };
      return current;
    });

    await expect(reconcileWorkflowFailure({ postId, eventId, error: { status: 503 } }, {
      getPost,
      checkpointPost,
      sleep,
    })).resolves.toEqual({ status: "reconciled", postId, stage: "research" });

    expect(checkpointPost).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
    expect(current.post.status).toBe("failed");
    expect(current.post.stages.research.status).toBe("failed");
    expect(current.post.error?.code).toBe("TERMINAL_FAILURE");
  });

  test("does not overwrite a completed post after a late failure", async () => {
    const source = { sourceId: "source-1", url: "https://example.com/report", title: "Report", fetchedEvidence: "Direct evidence" };
    const finding = { findingId: "finding-1", claim: "Claim", sourceId: source.sourceId, evidence: source.fetchedEvidence, corroboratingSourceIds: [], verdict: "supported" as const, rationale: "Direct support" };
    const article = { title: "Article", body: [{ type: "paragraph" as const, text: "Grounded claim", findingIds: [finding.findingId], sourceIds: [] }], citedSources: [{ sourceId: source.sourceId, url: source.url, title: source.title }] };
    const done = makePost({
      status: "done",
      stages: {
        research: { status: "done", attempts: 1, startedAt: at, endedAt: at },
        verify: { status: "done", attempts: 1, startedAt: at, endedAt: at },
        write: { status: "done", attempts: 1, startedAt: at, endedAt: at },
        edit: { status: "done", attempts: 1, startedAt: at, endedAt: at },
        illustrate: { status: "done", attempts: 1, startedAt: at, endedAt: at },
        publish: { status: "done", attempts: 1, startedAt: at, endedAt: at },
      },
      outputs: {
        evidence: { sources: [source], findings: [finding] },
        article,
        poster: { posterId: "507f1f77bcf86cd799439023", gridFsId: "507f1f77bcf86cd799439023", postId, stage: "illustrate", mediaType: "image/png", byteSize: 100, completedAt: at },
      },
      posterId: "507f1f77bcf86cd799439023",
    });
    const checkpointPost = vi.fn();

    await expect(reconcileWorkflowFailure({ postId, eventId, error: new Error("late failure") }, {
      getPost: vi.fn(async () => done),
      checkpointPost,
      sleep: vi.fn(async () => undefined),
    })).resolves.toEqual({ status: "already_terminal", postId });
    expect(checkpointPost).not.toHaveBeenCalled();
  });

  test("registers bounded retries and post-level singleton protection", () => {
    const createFunction = vi.fn((...args: unknown[]) => {
      void args;
      return {} as never;
    });
    createGeneratePostFunction({ createFunction } as unknown as InngestClient);
    const options = createFunction.mock.calls[0]?.[0] as unknown as { retries: number; idempotency: string; singleton: { key: string; mode: string } };
    expect(options.retries).toBe(3);
    expect(options.idempotency).toBe("event.data.eventId");
    expect(options.singleton).toEqual({ key: "event.data.postId", mode: "skip" });
  });

  test("retries a transient workflow result instead of treating it as successful", async () => {
    let current = makePost();
    const started = makePost({ dispatchState: "started" });
    const updateDispatch = vi.fn(async () => {
      current = started;
      return started;
    });
    const network = vi.fn(async (
      { state, revision }: { state: NetworkState; revision: number },
      dependencies: { checkpoint?: { save: (value: unknown) => Promise<{ state: NetworkState } | null> } },
    ) => {
      const saved = await dependencies.checkpoint?.save({
        state: {
          ...state,
          status: "failed",
          failure: toPublicError(new AppError("TERMINAL_FAILURE"), { postId, stage: "research" }),
        },
        expectedRevision: revision,
        reason: "failed",
      });
      return { status: "failed" as const, state: saved!.state, reason: "temporary" };
    });

    await expect(runGenerationWorkflow({ event: event(), step: step(), runId: eventId }, {
      getPost: vi.fn(async () => current),
      updateDispatch,
      runNetwork: network as never,
      getServerConfig: () => ({ limits: { networkMaxIterations: 6, stageCorrectionAttempts: 0, providerRetries: 0 } } as never),
    })).rejects.toThrow("temporary workflow failure");
    expect(updateDispatch).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledTimes(1);
    expect(current.post.status).toBe("queued");
  });
});
