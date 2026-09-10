import "server-only";

import { z } from "zod";
import {
  checkpointPost,
  getPost,
  updateDispatch,
  type PostSnapshot,
} from "../lib/posts";
import { getServerConfig, type ServerConfig } from "../lib/config";
import {
  createInitialState,
  networkStateSchema,
  type NetworkState,
} from "../lib/state";
import { STAGE_ORDER } from "../lib/stages";
import {
  checkpointWriteSchema,
  safeActivitySummary,
  type CheckpointSnapshot,
  type CheckpointStore,
  type CheckpointReason,
} from "../agents/checkpoints";
import { runNetwork, type NetworkDependencies, type NetworkResult } from "../agents/network";
import { publishPost, publisherInput, type PublisherResult } from "../agents/publisher";
import { createInngestClient, type InngestClient } from "./client";
import {
  GENERATION_REQUESTED_EVENT,
  generationRequestedEventSchema,
  type GenerationRequestedEvent,
} from "./events";

type Environment = Readonly<Record<string, string | undefined>>;

const workflowResultSchema = z.object({
  status: z.enum(["complete", "failed", "invalid"]),
  postId: z.string(),
  runId: z.string().optional(),
  reason: z.enum(["post_not_found", "event_mismatch", "network_failed", "invalid_network_input"]).optional(),
}).strict();

export type DurableWorkflowResult = z.infer<typeof workflowResultSchema>;

export type WorkflowStep = Readonly<{
  run: <T>(name: string, handler: () => Promise<T> | T) => Promise<T>;
}>;

export type GenerationWorkflowContext = Readonly<{
  event: GenerationRequestedEvent;
  step: WorkflowStep;
  runId: string;
}>;

export type DurableWorkflowDependencies = Readonly<{
  env?: Environment;
  getPost?: typeof getPost;
  updateDispatch?: typeof updateDispatch;
  checkpointPost?: typeof checkpointPost;
  runNetwork?: typeof runNetwork;
  publishPost?: typeof publishPost;
  getServerConfig?: typeof getServerConfig;
  network?: Partial<NetworkDependencies>;
}>;

type ReadyPost = Readonly<{ snapshot: PostSnapshot; action: "run" | "complete" | "failed" }>;
type LoadResult = ReadyPost | Readonly<{ reason: "post_not_found" | "event_mismatch" }>;

function networkIterationsFor(status: NetworkState["status"], stages: PostSnapshot["post"]["stages"]): number {
  if (status === "queued") return 0;
  if (status === "done") return STAGE_ORDER.length;
  if (status === "failed") return Math.min(STAGE_ORDER.length, STAGE_ORDER.filter((stage) => stages[stage].status !== "queued").length);
  return Math.min(STAGE_ORDER.length, STAGE_ORDER.indexOf(
    ({ researching: "research", verifying: "verify", writing: "write", editing: "edit", illustrating: "illustrate", publishing: "publish" } as const)[status],
  ) + 1);
}

/** Reconstruct the bounded network input from the persisted post, never from the event. */
export function networkStateFromPost(snapshot: PostSnapshot, runId: string, config: ServerConfig): NetworkState {
  const post = snapshot.post;
  return networkStateSchema.parse({
    ...createInitialState({
      postId: post.postId,
      runId,
      eventId: post.eventId,
      submissionKey: post.submissionKey,
      topic: post.topic,
      configuration: { model: post.model, image: post.image },
      budgets: {
        networkMaxIterations: config.limits.networkMaxIterations,
        stageCorrectionAttempts: config.limits.stageCorrectionAttempts,
        providerRetries: config.limits.providerRetries,
      },
      at: post.createdAt,
    }),
    status: post.status,
    stages: post.stages,
    ...(post.outputs.evidence ? { evidence: post.outputs.evidence } : {}),
    ...(post.outputs.article ? { article: post.outputs.article } : {}),
    ...(post.outputs.poster ? { image: post.outputs.poster } : {}),
    ...(post.error ? { failure: post.error } : {}),
    updatedAt: post.updatedAt,
    budgetUsage: {
      networkIterations: networkIterationsFor(post.status, post.stages),
      stageCorrectionAttempts: 0,
      providerRetries: 0,
    },
  });
}

function checkpointFromPost(
  snapshot: PostSnapshot,
  runId: string,
  config: ServerConfig,
  reason: CheckpointReason,
  activity?: string,
): CheckpointSnapshot {
  return {
    revision: snapshot.revision,
    postId: snapshot.post.postId,
    runId,
    state: networkStateFromPost(snapshot, runId, config),
    reason,
    ...(safeActivitySummary(activity) ? { activity: safeActivitySummary(activity) } : {}),
  };
}

function createPostCheckpointStore(
  dependencies: DurableWorkflowDependencies,
  config: ServerConfig,
  runId: string,
): CheckpointStore {
  const loadPost = dependencies.getPost ?? getPost;
  const savePost = dependencies.checkpointPost ?? checkpointPost;
  const env = dependencies.env;

  return {
    async load(postId) {
      const current = await loadPost(postId, env);
      if (!current || current.post.runId !== runId) return null;
      return checkpointFromPost(current, runId, config, "start");
    },
    async save(value) {
      const parsed = checkpointWriteSchema.parse(value);
      const current = await loadPost(parsed.state.postId, env);
      if (!current || current.post.runId !== runId) return null;

      // The publisher finalizes the post. A replayed completion must not try to
      // write a second terminal transition through checkpointPost.
      if (parsed.state.status === "done") {
        if (current.post.status !== "done") return null;
        return {
          revision: current.revision,
          postId: current.post.postId,
          runId,
          state: parsed.state,
          reason: parsed.reason,
          ...(safeActivitySummary(parsed.activity) ? { activity: safeActivitySummary(parsed.activity) } : {}),
        };
      }
      if (parsed.expectedRevision !== undefined && current.revision !== parsed.expectedRevision) return null;

      const saved = await savePost(current.post.postId, current.revision, {
        status: parsed.state.status,
        stages: parsed.state.stages,
        outputs: {
          ...(parsed.state.evidence ? { evidence: parsed.state.evidence } : {}),
          ...(parsed.state.article ? { article: parsed.state.article } : {}),
          ...(parsed.state.image ? { poster: parsed.state.image } : {}),
        },
        ...(parsed.state.failure ? { error: parsed.state.failure } : {}),
      }, env);
      return saved ? checkpointFromPost(saved, runId, config, parsed.reason, parsed.activity) : null;
    },
  };
}

function createNetworkDependencies(
  dependencies: DurableWorkflowDependencies,
  config: ServerConfig,
  runId: string,
): Parameters<typeof runNetwork>[1] {
  const loadPost = dependencies.getPost ?? getPost;
  const sendPost = dependencies.publishPost ?? publishPost;
  const env = dependencies.env;

  const durablePublisher: typeof publishPost = async (value): Promise<PublisherResult> => {
    const parsed = publisherInput.safeParse(value);
    if (!parsed.success) return { status: "invalid_input" };
    const current = await loadPost(parsed.data.postId, env);
    if (!current) return { status: "failed" };
    return sendPost({ ...parsed.data, revision: current.revision }, { env });
  };

  return {
    ...dependencies.network,
    checkpoint: createPostCheckpointStore(dependencies, config, runId),
    publisher: durablePublisher,
    env,
    serverConfig: config,
  };
}

function summarizeNetworkResult(postId: string, runId: string, result: NetworkResult): DurableWorkflowResult {
  if (result.status === "complete") return workflowResultSchema.parse({ status: "complete", postId, runId });
  if (result.status === "invalid_input") return workflowResultSchema.parse({ status: "invalid", postId, reason: "invalid_network_input" });
  return workflowResultSchema.parse({ status: "failed", postId, runId, reason: "network_failed" });
}

/** Execute the durable workflow body; the endpoint task only needs to register this function. */
export async function runGenerationWorkflow(
  context: GenerationWorkflowContext,
  dependencies: DurableWorkflowDependencies = {},
): Promise<DurableWorkflowResult> {
  const event = generationRequestedEventSchema.parse(context.event);
  const postId = event.data.postId;
  const eventId = event.data.eventId;
  const loadPost = dependencies.getPost ?? getPost;
  const markDispatch = dependencies.updateDispatch ?? updateDispatch;
  const env = dependencies.env;

  const loaded = await context.step.run("load-saved-post", async (): Promise<LoadResult> => {
    const snapshot = await loadPost(postId, env);
    if (!snapshot) return { reason: "post_not_found" };
    if (snapshot.post.eventId !== eventId) return { reason: "event_mismatch" };
    if (snapshot.post.status === "done") return { snapshot, action: "complete" };
    if (snapshot.post.status === "failed") return { snapshot, action: "failed" };
    return { snapshot, action: "run" };
  });

  if ("reason" in loaded) return { status: "invalid", postId, reason: loaded.reason };
  if (loaded.action === "complete") {
    return { status: "complete", postId, runId: loaded.snapshot.post.runId ?? eventId };
  }
  if (loaded.action === "failed") {
    return { status: "failed", postId, runId: loaded.snapshot.post.runId ?? eventId, reason: "network_failed" };
  }

  const started = await context.step.run("mark-dispatch-started", async (): Promise<ReadyPost | null> => {
    const current = await loadPost(postId, env);
    if (!current || current.post.eventId !== eventId) return null;
    if (current.post.status === "done") return { snapshot: current, action: "complete" };
    if (current.post.status === "failed") return { snapshot: current, action: "failed" };
    const updated = await markDispatch(postId, current.revision, { state: "started", eventId, runId: eventId }, env);
    if (updated) return { snapshot: updated, action: "run" };
    const replay = await loadPost(postId, env);
    if (!replay || replay.post.eventId !== eventId) return null;
    if (replay.post.status === "done") return { snapshot: replay, action: "complete" };
    if (replay.post.status === "failed") return { snapshot: replay, action: "failed" };
    return replay.post.runId === eventId && replay.post.dispatchState === "started"
      ? { snapshot: replay, action: "run" }
      : null;
  });

  if (!started) return { status: "invalid", postId, reason: "event_mismatch" };
  if (started.action === "complete") return { status: "complete", postId, runId: started.snapshot.post.runId ?? eventId };
  if (started.action === "failed") return { status: "failed", postId, runId: started.snapshot.post.runId ?? eventId, reason: "network_failed" };

  const config = (dependencies.getServerConfig ?? getServerConfig)(env);
  return context.step.run("run-agent-network", async () => {
    const state = networkStateFromPost(started.snapshot, eventId, config);
    const execute = dependencies.runNetwork ?? runNetwork;
    const result = await execute(
      { state, revision: started.snapshot.revision },
      createNetworkDependencies(dependencies, config, eventId),
    );
    return summarizeNetworkResult(postId, eventId, result);
  });
}

/** Register the workflow without eagerly reading production credentials at import time. */
export function createGeneratePostFunction(client: InngestClient = createInngestClient()) {
  return client.createFunction(
    {
      id: "post-forge-generate-post",
      name: "Generate Post",
      retries: 3,
      idempotency: "event.data.eventId",
      checkpointing: true,
    },
    { event: GENERATION_REQUESTED_EVENT },
    async ({ event, step, runId }) => runGenerationWorkflow({
      event: generationRequestedEventSchema.parse(event),
      step: step as unknown as WorkflowStep,
      runId,
    }),
  );
}

export const createGeneratePost = createGeneratePostFunction;
