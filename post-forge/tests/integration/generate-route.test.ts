import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "../../src/app/api/generate/route";
import { createInitialStages } from "../../src/lib/stages";
import { postSchema, type Post } from "../../src/lib/contracts/post";
import { SubmissionConflictError, type PostSnapshot } from "../../src/lib/posts";
import { submitGeneration } from "../../src/lib/generation-dispatch";

const postId = "507f1f77bcf86cd799439011";
const eventId = "507f1f77bcf86cd799439012";
const at = "2026-09-11T08:00:00.000Z";
const config = {
  openrouter: { apiKey: "fake", model: "model" },
  image: { provider: "gemini" as const, model: "image-model", apiKey: "fake" },
} as never;

function snapshot(overrides: Partial<Post> = {}, revision = 0): PostSnapshot {
  return {
    revision,
    post: postSchema.parse({
      postId,
      eventId,
      submissionKey: "submission_1",
      topic: "A useful topic",
      status: "queued",
      dispatchState: "queued",
      schemaVersion: 1,
      model: { provider: "openrouter", model: "model" },
      image: { provider: "gemini", model: "image-model" },
      stages: createInitialStages(),
      outputs: {},
      createdAt: at,
      updatedAt: at,
      ...overrides,
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("generation submission API", () => {
  test("rejects invalid input before persistence", async () => {
    const createPost = vi.fn();

    await expect(submitGeneration({ topic: "   ", submissionKey: "bad key" }, {
      config,
      createPost,
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(createPost).not.toHaveBeenCalled();
  });

  test("persists the model/provider snapshot before sending and returns the stable identity", async () => {
    const saved = snapshot();
    const createPost = vi.fn(async () => saved);
    const send = vi.fn(async () => ({ ids: [eventId] }));
    const updateDispatch = vi.fn(async () => snapshot({ dispatchState: "dispatched" }, 1));

    await expect(submitGeneration({ topic: saved.post.topic, submissionKey: saved.post.submissionKey }, {
      config,
      createPost,
      client: { send },
      updateDispatch,
    })).resolves.toEqual({ postId, eventId, dispatchState: "dispatched" });

    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({
      model: { provider: "openrouter", model: "model" },
      image: { provider: "gemini", model: "image-model" },
    }), undefined);
    expect(send).toHaveBeenCalledWith({
      name: "post/generate.requested",
      data: { postId, eventId },
    });
    expect(updateDispatch).toHaveBeenCalledWith(postId, 0, { state: "dispatched", eventId }, undefined);
  });

  test("reuses a sent or started submission without sending a second event", async () => {
    const createPost = vi.fn(async () => snapshot({ dispatchState: "started", runId: eventId }));
    const send = vi.fn();

    await expect(submitGeneration({ topic: "A useful topic", submissionKey: "submission_1" }, {
      config,
      createPost,
      client: { send },
    })).resolves.toMatchObject({ postId, eventId, dispatchState: "started" });
    expect(send).not.toHaveBeenCalled();
  });

  test("marks dispatch failure and returns a sanitized retriable identity", async () => {
    const saved = snapshot();
    const send = vi.fn(async () => { throw new Error("provider secret and raw payload"); });
    const updateDispatch = vi.fn(async () => snapshot({ dispatchState: "failed" }, 1));

    await expect(submitGeneration({ topic: saved.post.topic, submissionKey: saved.post.submissionKey }, {
      config,
      createPost: vi.fn(async () => saved),
      client: { send },
      updateDispatch,
    })).rejects.toMatchObject({
      name: "GenerationDispatchError",
      postId,
      publicError: { code: "TRANSIENT_FAILURE", retryable: true, postId },
    });
    expect(updateDispatch).toHaveBeenCalledWith(postId, 0, { state: "failed", eventId }, undefined);
  });

  test("does not reset a workflow that races the dispatch update", async () => {
    const saved = snapshot();
    const started = snapshot({ dispatchState: "started", runId: eventId }, 1);
    const send = vi.fn(async () => ({ ids: [eventId] }));
    const updateDispatch = vi.fn(async () => null);
    const getPost = vi.fn(async () => started);

    await expect(submitGeneration({ topic: saved.post.topic, submissionKey: saved.post.submissionKey }, {
      config,
      createPost: vi.fn(async () => saved),
      client: { send },
      updateDispatch,
      getPost,
    })).resolves.toMatchObject({ postId, eventId, dispatchState: "started" });
    expect(updateDispatch).not.toHaveBeenCalledWith(postId, 1, expect.objectContaining({ state: "dispatched" }), undefined);
  });

  test("preserves a different-topic conflict for the route to map to HTTP 409", async () => {
    const conflict = new SubmissionConflictError();
    await expect(submitGeneration({ topic: "Other topic", submissionKey: "submission_1" }, {
      config,
      createPost: vi.fn(async () => { throw conflict; }),
    })).rejects.toBe(conflict);
  });

  test("sanitizes invalid JSON", async () => {
    const response = await POST(new Request("http://localhost/api/generate", {
      method: "POST",
      body: "not-json",
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.objectContaining({ code: "INVALID_INPUT", message: expect.not.stringContaining("not-json") }),
    });
  });
});
