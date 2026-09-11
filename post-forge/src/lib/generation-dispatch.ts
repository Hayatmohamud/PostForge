import "server-only";

import {
  generateRequestSchema,
} from "./contracts/api";
import {
  createGenerationRequestedEvent,
  type GenerationRequestedEvent,
} from "../inngest/events";
import { createInngestClient, type InngestClient } from "../inngest/client";
import {
  getServerConfig,
  type ServerConfig,
} from "./config";
import {
  AppError,
  classifyError,
  toPublicError,
  type ErrorCode,
  type PublicError,
} from "./errors";
import {
  createOrReusePost,
  getPost,
  SubmissionConflictError,
  updateDispatch,
  type CreatePostInput,
  type PostSnapshot,
} from "./posts";

type Environment = Readonly<Record<string, string | undefined>>;
type EventSender = Pick<InngestClient, "send">;

export type GenerationDispatchDependencies = Readonly<{
  env?: Environment;
  config?: ServerConfig;
  getServerConfig?: typeof getServerConfig;
  createPost?: typeof createOrReusePost;
  getPost?: typeof getPost;
  updateDispatch?: typeof updateDispatch;
  createClient?: (options: { config: ServerConfig; env?: Environment }) => EventSender;
  client?: EventSender;
}>;

export type GenerationSubmission = Readonly<{
  postId: string;
  eventId: string;
  dispatchState: "dispatched" | "started";
}>;

/** Error carrying only the generated identity and a sanitized public error. */
export class GenerationDispatchError extends Error {
  readonly postId: string;
  readonly publicError: PublicError;

  constructor(error: unknown, postId: string) {
    super("Generation submission failed.");
    this.name = "GenerationDispatchError";
    this.postId = postId;
    this.publicError = toPublicError(error, { postId });
    Object.freeze(this);
  }
}

function generatedEventId(snapshot: PostSnapshot): string {
  const eventId = snapshot.post.eventId;
  if (!eventId) throw new GenerationDispatchError(new AppError("TERMINAL_FAILURE"), snapshot.post.postId);
  return eventId;
}

function accepted(snapshot: PostSnapshot, eventId: string): GenerationSubmission | null {
  if (snapshot.post.eventId !== eventId) return null;
  if (snapshot.post.dispatchState !== "dispatched" && snapshot.post.dispatchState !== "started") return null;
  return {
    postId: snapshot.post.postId,
    eventId,
    dispatchState: snapshot.post.dispatchState,
  };
}

function dispatchError(error: unknown): AppError {
  const code = classifyError(error);
  // An unclassified exception at the event transport boundary is treated as
  // ambiguous/transient. The stable event ID makes a retry safe.
  return new AppError(code === "TERMINAL_FAILURE" ? "TRANSIENT_FAILURE" : code);
}

function terminalPostError(snapshot: PostSnapshot): GenerationDispatchError {
  const code: ErrorCode = snapshot.post.error?.code ?? "TERMINAL_FAILURE";
  return new GenerationDispatchError(new AppError(code), snapshot.post.postId);
}

async function reload(
  loadPost: typeof getPost,
  postId: string,
  env: Environment | undefined,
): Promise<PostSnapshot | null> {
  try {
    return await loadPost(postId, env);
  } catch {
    return null;
  }
}

async function markFailure(
  snapshot: PostSnapshot,
  eventId: string,
  dependencies: GenerationDispatchDependencies,
): Promise<GenerationSubmission | null> {
  const mark = dependencies.updateDispatch ?? updateDispatch;
  const loadPost = dependencies.getPost ?? getPost;
  let updated: PostSnapshot | null = null;
  try {
    updated = await mark(snapshot.post.postId, snapshot.revision, { state: "failed", eventId }, dependencies.env);
  } catch {
    // The original dispatch failure remains the safe response. A later retry
    // can recover the queued/failed state using the same event identity.
  }
  const progressed = updated ? accepted(updated, eventId) : null;
  if (progressed) return progressed;
  const current = await reload(loadPost, snapshot.post.postId, dependencies.env);
  return current ? accepted(current, eventId) : null;
}

async function sendAndPersist(
  snapshot: PostSnapshot,
  event: GenerationRequestedEvent,
  dependencies: GenerationDispatchDependencies,
): Promise<GenerationSubmission> {
  const eventId = event.data.eventId;
  const postId = snapshot.post.postId;
  const sender = dependencies.client ?? dependencies.createClient?.({
    config: dependencies.config ?? (dependencies.getServerConfig ?? getServerConfig)(dependencies.env),
    env: dependencies.env,
  }) ?? createInngestClient({
    config: dependencies.config ?? (dependencies.getServerConfig ?? getServerConfig)(dependencies.env),
    env: dependencies.env,
  });

  try {
    await sender.send(event);
  } catch (error) {
    const progressed = await markFailure(snapshot, eventId, dependencies);
    if (progressed) return progressed;
    throw new GenerationDispatchError(dispatchError(error), postId);
  }

  // The event is accepted before the HTTP request can be successful. A CAS
  // miss is reconciled by reloading, and never by sending another event or
  // reverting a workflow that already marked itself started.
  const mark = dependencies.updateDispatch ?? updateDispatch;
  let updated: PostSnapshot | null = null;
  try {
    updated = await mark(postId, snapshot.revision, { state: "dispatched", eventId }, dependencies.env);
  } catch {
    return { postId, eventId, dispatchState: "dispatched" };
  }
  const persisted = updated ? accepted(updated, eventId) : null;
  if (persisted) return persisted;

  const loadPost = dependencies.getPost ?? getPost;
  const current = await reload(loadPost, postId, dependencies.env);
  return current && accepted(current, eventId)
    ? accepted(current, eventId)!
    : { postId, eventId, dispatchState: "dispatched" };
}

/** Persist a submission, then dispatch its stable event exactly after persistence. */
export async function submitGeneration(
  value: unknown,
  dependencies: GenerationDispatchDependencies = {},
): Promise<GenerationSubmission> {
  const parsed = generateRequestSchema.safeParse(value);
  if (!parsed.success) throw new AppError("INVALID_INPUT");

  const config = dependencies.config ?? (dependencies.getServerConfig ?? getServerConfig)(dependencies.env);
  const input: CreatePostInput = {
    ...parsed.data,
    model: { provider: "openrouter", model: config.openrouter.model },
    image: { provider: config.image.provider, model: config.image.model },
  };
  const createPost = dependencies.createPost ?? createOrReusePost;
  const snapshot = await createPost(input, dependencies.env);
  const eventId = generatedEventId(snapshot);

  if (snapshot.post.status === "failed") throw terminalPostError(snapshot);
  if (snapshot.post.dispatchState === "dispatched" || snapshot.post.dispatchState === "started") {
    return accepted(snapshot, eventId)!;
  }

  try {
    return await sendAndPersist(snapshot, createGenerationRequestedEvent({ postId: snapshot.post.postId, eventId }), {
      ...dependencies,
      config,
    });
  } catch (error) {
    if (error instanceof GenerationDispatchError || error instanceof SubmissionConflictError) throw error;
    throw new GenerationDispatchError(error, snapshot.post.postId);
  }
}

export const dispatchGeneration = submitGeneration;
