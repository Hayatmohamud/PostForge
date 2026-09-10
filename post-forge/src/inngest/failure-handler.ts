import "server-only";

import { z } from "zod";
import {
  checkpointPost,
  getPost,
  type PostSnapshot,
} from "../lib/posts";
import { AppError, toPublicError, type PublicError } from "../lib/errors";
import { currentStage, failStage, type StageName } from "../lib/stages";
import { generationRequestedEventSchema } from "./events";

type Environment = Readonly<Record<string, string | undefined>>;

const retryDelaysMs = [100, 500, 1_000] as const;

export type FailurePersistenceDependencies = Readonly<{
  env?: Environment;
  getPost?: typeof getPost;
  checkpointPost?: typeof checkpointPost;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
}>;

export type WorkflowFailureResult = Readonly<{
  status: "reconciled" | "already_terminal" | "ignored" | "retry_exhausted";
  postId?: string;
  stage?: StageName;
}>;

export type WorkflowFailureInput = Readonly<{
  postId: string;
  eventId: string;
  runId?: string;
  error: unknown;
}>;

const failureInputSchema = z.object({
  postId: z.string().min(1),
  eventId: z.string().min(1),
  runId: z.string().min(1).optional(),
  error: z.unknown(),
}).strict();

const failureContextSchema = z.object({
  event: z.unknown(),
  error: z.unknown(),
}).passthrough();

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Retry only the persistence boundary; provider work is never repeated here. */
async function retryPersistence<T>(
  operation: (attempt: number) => Promise<T | null>,
  dependencies: FailurePersistenceDependencies,
): Promise<T | null> {
  const maxAttempts = Math.max(1, Math.min(dependencies.maxAttempts ?? retryDelaysMs.length, retryDelaysMs.length));
  const sleep = dependencies.sleep ?? wait;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation(attempt);
      if (result !== null) return result;
    } catch {
      // Make a bounded effort without exposing database or provider diagnostics.
    }
    if (attempt < maxAttempts) await sleep(retryDelaysMs[attempt - 1]);
  }
  return null;
}

function activeFailureStage(snapshot: PostSnapshot): StageName | undefined {
  return currentStage(snapshot.post.stages);
}

function terminalError(error: unknown, postId: string, stage?: StageName): PublicError {
  const safe = toPublicError(error, { postId, stage });
  return safe.retryable
    ? toPublicError(new AppError("TERMINAL_FAILURE"), { postId, stage })
    : safe;
}

/** Reconcile an exhausted workflow failure through the same CAS checkpoint boundary. */
export async function reconcileWorkflowFailure(
  value: unknown,
  dependencies: FailurePersistenceDependencies = {},
): Promise<WorkflowFailureResult> {
  const parsed = failureInputSchema.safeParse(value);
  if (!parsed.success) return { status: "ignored" };

  const loadPost = dependencies.getPost ?? getPost;
  const savePost = dependencies.checkpointPost ?? checkpointPost;
  const { postId, eventId, runId, error } = parsed.data;
  let terminal: WorkflowFailureResult | null = null;

  const saved = await retryPersistence(async () => {
    const current = await loadPost(postId, dependencies.env);
    if (!current || current.post.eventId !== eventId || (runId && current.post.runId && current.post.runId !== runId)) {
      terminal = { status: "ignored", postId };
      return terminal;
    }
    if (current.post.status === "done" || current.post.status === "failed") {
      terminal = { status: "already_terminal", postId, stage: activeFailureStage(current) };
      return terminal;
    }

    const stage = activeFailureStage(current);
    const stages = stage ? failStage(current.post.stages, stage) : current.post.stages;
    const failure = terminalError(error, postId, stage);
    const updated = await savePost(current.post.postId, current.revision, {
      status: "failed",
      stages,
      outputs: current.post.outputs,
      error: failure,
    }, dependencies.env);
    if (!updated) return null;
    return { status: "reconciled" as const, postId, ...(stage ? { stage } : {}) };
  }, dependencies);

  return saved ?? terminal ?? { status: "retry_exhausted", postId };
}

/** Adapt Inngest's failure payload without persisting its untrusted event envelope. */
export async function handleInngestFailure(
  value: unknown,
  dependencies: FailurePersistenceDependencies = {},
): Promise<WorkflowFailureResult> {
  const parsed = failureContextSchema.safeParse(value);
  if (!parsed.success) return { status: "ignored" };
  const event = generationRequestedEventSchema.safeParse(parsed.data.event);
  if (!event.success) return { status: "ignored" };
  return reconcileWorkflowFailure({
    postId: event.data.data.postId,
    eventId: event.data.data.eventId,
    error: parsed.data.error,
  }, dependencies);
}
