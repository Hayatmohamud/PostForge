import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createInitialStages, transitionStage } from "../../src/lib/stages";
import { postSchema, type Post } from "../../src/lib/contracts/post";
import { getServerConfig } from "../../src/lib/config";
import { runGenerationWorkflow, type WorkflowStep } from "../../src/inngest/generate-post";
import { GENERATION_REQUESTED_EVENT } from "../../src/inngest/events";
import type { DispatchUpdate, PostSnapshot } from "../../src/lib/posts";

const postId = "507f1f77bcf86cd799439011";
const eventId = "507f1f77bcf86cd799439012";
const posterId = "507f1f77bcf86cd799439013";
const at = "2026-09-10T12:00:00.000Z";
const configuration = { model: { provider: "openrouter", model: "model" }, image: { provider: "gemini", model: "image-model" } };
const source = { sourceId: "source-1", url: "https://example.com/report", title: "Report", fetchedEvidence: "Direct evidence" };
const finding = { findingId: "finding-1", claim: "Claim", sourceId: source.sourceId, evidence: source.fetchedEvidence, corroboratingSourceIds: [] };
const evidence = { sources: [source], findings: [{ ...finding, verdict: "supported" as const, rationale: "Direct support" }] };
const article = { title: "Article", body: [{ type: "paragraph" as const, text: "Grounded claim", findingIds: [finding.findingId], sourceIds: [] }], citedSources: [{ sourceId: source.sourceId, url: source.url, title: source.title }] };
const poster = { posterId, gridFsId: posterId, postId, stage: "illustrate" as const, mediaType: "image/png" as const, byteSize: 1024, completedAt: at };

function env() {
  return {
    OPENROUTER_API_KEY: "fake-openrouter",
    OPENROUTER_MODEL: "model",
    SERPER_API_KEY: "fake-serper",
    GEMINI_API_KEY: "fake-gemini",
    IMAGE_PROVIDER: "gemini",
    IMAGE_MODEL: "image-model",
    MONGODB_URI: "mongodb://fake-user:fake-password@localhost:27017",
    MONGODB_DB: "postforge_test_workflow",
    INNGEST_DEV: "true",
  };
}

function makePost(overrides: Partial<Post> = {}): PostSnapshot {
  const post = postSchema.parse({
    postId,
    submissionKey: "submission_1",
    topic: "A bounded topic",
    status: "queued",
    dispatchState: "queued",
    eventId,
    schemaVersion: 1,
    model: configuration.model,
    image: configuration.image,
    stages: createInitialStages(),
    outputs: {},
    createdAt: at,
    updatedAt: at,
    ...overrides,
  });
  return { post, revision: 0 };
}

function step(): { context: WorkflowStep; names: string[] } {
  const names: string[] = [];
  return {
    names,
    context: {
      run: async <T>(name: string, handler: () => Promise<T> | T): Promise<T> => {
        names.push(name);
        return handler();
      },
    },
  };
}

function event(): { name: typeof GENERATION_REQUESTED_EVENT; data: { postId: string; eventId: string } } {
  return { name: GENERATION_REQUESTED_EVENT, data: { postId, eventId } };
}

function networkDependencies() {
  return {
    research: vi.fn().mockResolvedValue({ status: "complete", sources: [source], findings: [finding] }),
    verify: vi.fn().mockResolvedValue({ status: "complete", evidence }),
    writer: vi.fn().mockResolvedValue({ status: "complete", article }),
    editor: vi.fn().mockResolvedValue({ status: "complete", article }),
    illustrator: vi.fn().mockResolvedValue({ status: "complete", poster: { id: poster.posterId, postId: poster.postId, stage: poster.stage, mediaType: poster.mediaType, byteSize: poster.byteSize, completedAt: poster.completedAt } }),
    imageConfig: () => ({ provider: "gemini", model: "image-model", apiKey: "injected" }),
    now: () => at,
  };
}

describe("durable generation workflow", () => {
  test("validates the event, persists stage boundaries, resumes from checkpoints, and finalizes once", async () => {
    let current = makePost();
    const getPost = vi.fn(async () => current);
    const updateDispatch = vi.fn(async (_postId: string, expectedRevision: number, update: DispatchUpdate) => {
      if (update.state !== "started") return null;
      if (current.revision !== expectedRevision) return null;
      current = { revision: current.revision + 1, post: postSchema.parse({ ...current.post, dispatchState: update.state, runId: update.runId, updatedAt: at }) };
      return current;
    });
    const checkpointPost = vi.fn(async (_postId: string, expectedRevision: number, checkpoint: { status: Post["status"]; stages: Post["stages"]; outputs: Post["outputs"]; error?: unknown }) => {
      if (current.revision !== expectedRevision) return null;
      current = {
        revision: current.revision + 1,
        post: postSchema.parse({ ...current.post, status: checkpoint.status, stages: checkpoint.stages, outputs: { ...current.post.outputs, ...checkpoint.outputs }, error: checkpoint.error, updatedAt: at }),
      };
      return current;
    });
    const publishPost = vi.fn(async (value: unknown) => {
      const input = value as { evidence: typeof evidence; article: typeof article; poster: unknown };
      current = {
        revision: current.revision + 2,
        post: postSchema.parse({
          ...current.post,
          status: "done",
          stages: transitionStage(current.post.stages, "publish", "done", at),
          outputs: { evidence: input.evidence, article: input.article, poster: input.poster },
          posterId,
          updatedAt: at,
        }),
      };
      return { status: "published", post: current } as const;
    });
    const deps = networkDependencies();
    const first = step();

    await expect(runGenerationWorkflow({ event: event(), step: first.context, runId: "inngest-run" }, {
      env: env(),
      getPost,
      updateDispatch,
      checkpointPost,
      publishPost,
      getServerConfig: (value) => getServerConfig(value ?? env()),
      network: deps,
    })).resolves.toEqual({ status: "complete", postId, runId: eventId });

    expect(first.names).toEqual(["load-saved-post", "mark-dispatch-started", "run-agent-network"]);
    expect(current.post.status).toBe("done");
    expect(checkpointPost.mock.calls.length).toBeGreaterThan(6);
    expect(deps.research).toHaveBeenCalledTimes(1);
    expect(publishPost).toHaveBeenCalledTimes(1);

    const replay = step();
    await expect(runGenerationWorkflow({ event: event(), step: replay.context, runId: "another-inngest-run" }, {
      env: env(), getPost, updateDispatch, checkpointPost, publishPost,
      getServerConfig: (value) => getServerConfig(value ?? env()), network: deps,
    })).resolves.toEqual({ status: "complete", postId, runId: eventId });
    expect(replay.names).toEqual(["load-saved-post"]);
    expect(deps.research).toHaveBeenCalledTimes(1);
    expect(publishPost).toHaveBeenCalledTimes(1);
  });

  test("keeps a transient failure non-terminal until retry exhaustion", async () => {
    let current = makePost();
    const deps = networkDependencies();
    deps.research.mockRejectedValue(new Error("provider-secret"));
    const getPost = vi.fn(async () => current);
    const updateDispatch = vi.fn(async (_postId: string, expectedRevision: number, update: DispatchUpdate) => {
      if (update.state !== "started") return null;
      if (current.revision !== expectedRevision) return null;
      current = { revision: current.revision + 1, post: postSchema.parse({ ...current.post, dispatchState: update.state, runId: update.runId }) };
      return current;
    });
    const checkpointPost = vi.fn(async (_postId: string, expectedRevision: number, checkpoint: { status: Post["status"]; stages: Post["stages"]; outputs: Post["outputs"]; error?: unknown }) => {
      if (current.revision !== expectedRevision) return null;
      current = { revision: current.revision + 1, post: postSchema.parse({ ...current.post, status: checkpoint.status, stages: checkpoint.stages, outputs: { ...current.post.outputs, ...checkpoint.outputs }, error: checkpoint.error }) };
      return current;
    });
    const currentStep = step();

    await expect(runGenerationWorkflow({ event: event(), step: currentStep.context, runId: "inngest-run" }, {
      env: env(), getPost, updateDispatch, checkpointPost,
      getServerConfig: (value) => getServerConfig(value ?? env()), network: deps,
    })).resolves.toEqual({ status: "failed", postId, runId: eventId, reason: "network_failed" });
    // TASK-029 keeps retryable workflow failures out of the persisted terminal
    // state so the durable runner can replay the current stage.
    expect(current.post.status).toBe("researching");
    expect(JSON.stringify(current)).not.toContain("provider-secret");
    expect(deps.research).toHaveBeenCalledTimes(1);
  });

  test("rejects an event whose persisted identity does not match", async () => {
    const current = makePost({ eventId: "507f1f77bcf86cd799439014" });
    const workflow = step();
    await expect(runGenerationWorkflow({ event: event(), step: workflow.context, runId: "inngest-run" }, {
      getPost: vi.fn(async () => current),
    })).resolves.toEqual({ status: "invalid", postId, reason: "event_mismatch" });
    expect(workflow.names).toEqual(["load-saved-post"]);
  });
});
