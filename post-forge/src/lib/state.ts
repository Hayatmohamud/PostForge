import { z } from "zod";
import {
  articleSchema,
  imageSnapshotSchema,
  postStatusSchema,
  publicErrorSchema,
  modelSnapshotSchema,
  posterSchema,
  stagesSchema,
  type PostStatus,
} from "./contracts/post";
import {
  evidenceBundleSchema,
  generatedIdSchema,
  submissionKeySchema,
} from "./contracts/evidence";
import {
  STAGE_ORDER,
  activateStage,
  completeStage,
  currentStage,
  failStage,
  type StageName,
} from "./stages";

export const NETWORK_STATE_SCHEMA_VERSION = 1 as const;
export const STATE_LIMITS = Object.freeze({ maxSerializedChars: 1_000_000, maxActivityChars: 500 });

export const networkBudgetSchema = z.object({
  networkMaxIterations: z.number().int().min(6).max(60),
  stageCorrectionAttempts: z.number().int().min(0).max(3),
  providerRetries: z.number().int().min(0).max(3),
}).strict();

export const budgetUsageSchema = z.object({
  networkIterations: z.number().int().min(0).max(60),
  stageCorrectionAttempts: z.number().int().min(0).max(3),
  providerRetries: z.number().int().min(0).max(3),
}).strict();

export const configurationSnapshotSchema = z.object({
  model: modelSnapshotSchema,
  image: imageSnapshotSchema,
}).strict();

const isoDateSchema = z.string().datetime({ offset: true }).max(64);

export const networkStateSchema = z.object({
  schemaVersion: z.literal(NETWORK_STATE_SCHEMA_VERSION),
  postId: generatedIdSchema,
  submissionKey: submissionKeySchema,
  topic: z.string().trim().min(1).max(2_000),
  eventId: generatedIdSchema.optional(),
  runId: generatedIdSchema.optional(),
  status: postStatusSchema,
  configuration: configurationSnapshotSchema,
  stages: stagesSchema,
  evidence: evidenceBundleSchema.optional(),
  article: articleSchema.optional(),
  image: posterSchema.optional(),
  budgets: networkBudgetSchema,
  budgetUsage: budgetUsageSchema,
  failure: publicErrorSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
}).strict().superRefine((state, context) => {
  if (Date.parse(state.updatedAt) < Date.parse(state.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "Updated time cannot precede created time" });
  }
  if (state.budgetUsage.networkIterations > state.budgets.networkMaxIterations) {
    context.addIssue({ code: "custom", path: ["budgetUsage", "networkIterations"], message: "Network iteration budget exceeded" });
  }
  if (state.budgetUsage.stageCorrectionAttempts > state.budgets.stageCorrectionAttempts) {
    context.addIssue({ code: "custom", path: ["budgetUsage", "stageCorrectionAttempts"], message: "Stage correction budget exceeded" });
  }
  if (state.budgetUsage.providerRetries > state.budgets.providerRetries) {
    context.addIssue({ code: "custom", path: ["budgetUsage", "providerRetries"], message: "Provider retry budget exceeded" });
  }
  if (state.image && state.image.postId !== state.postId) {
    context.addIssue({ code: "custom", path: ["image", "postId"], message: "Image belongs to another post" });
  }
  if (state.failure?.postId && state.failure.postId !== state.postId) {
    context.addIssue({ code: "custom", path: ["failure", "postId"], message: "Failure belongs to another post" });
  }
  if (state.status === "failed" && !state.failure) {
    context.addIssue({ code: "custom", path: ["failure"], message: "Failed state requires a safe failure" });
  }
  if (state.status === "done") {
    if (!state.evidence || !state.article || !state.image) {
      context.addIssue({ code: "custom", path: ["status"], message: "Done state requires evidence, article, and image" });
    } else if (!state.evidence.findings.some((finding) => finding.verdict === "supported")) {
      context.addIssue({ code: "custom", path: ["evidence"], message: "Done state requires supported evidence" });
    }
  }
  if (state.article && state.evidence) {
    const findingIds = new Set(state.evidence.findings.map((finding) => finding.findingId));
    const sourceIds = new Set(state.evidence.sources.map((source) => source.sourceId));
    for (const [index, block] of state.article.body.entries()) {
      for (const findingId of block.findingIds) {
        if (!findingIds.has(findingId)) context.addIssue({ code: "custom", path: ["article", "body", index, "findingIds"], message: "Article references an unknown finding" });
      }
      for (const sourceId of block.sourceIds) {
        if (!sourceIds.has(sourceId)) context.addIssue({ code: "custom", path: ["article", "body", index, "sourceIds"], message: "Article references an unknown source" });
      }
    }
    for (const [index, source] of state.article.citedSources.entries()) {
      if (!sourceIds.has(source.sourceId)) context.addIssue({ code: "custom", path: ["article", "citedSources", index, "sourceId"], message: "Article cites an unknown source" });
    }
  }
});

export type NetworkBudget = z.infer<typeof networkBudgetSchema>;
export type BudgetUsage = z.infer<typeof budgetUsageSchema>;
export type ConfigurationSnapshot = z.infer<typeof configurationSnapshotSchema>;
export type NetworkState = z.infer<typeof networkStateSchema>;

const initialStateInputSchema = z.object({
  postId: generatedIdSchema,
  submissionKey: submissionKeySchema,
  topic: z.string().trim().min(1).max(2_000),
  eventId: generatedIdSchema.optional(),
  runId: generatedIdSchema.optional(),
  configuration: configurationSnapshotSchema,
  budgets: networkBudgetSchema,
  at: isoDateSchema.optional(),
}).strict();

export type InitialStateInput = z.input<typeof initialStateInputSchema>;

function timestamp(at?: string): string {
  return isoDateSchema.parse(at ?? new Date().toISOString());
}

/** Create a queued, durable state with every stage explicitly unstarted. */
export function createInitialState(value: unknown): NetworkState {
  const input = initialStateInputSchema.parse(value);
  const now = timestamp(input.at);
  return networkStateSchema.parse({
    schemaVersion: NETWORK_STATE_SCHEMA_VERSION,
    postId: input.postId,
    submissionKey: input.submissionKey,
    topic: input.topic,
    ...(input.eventId ? { eventId: input.eventId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    status: "queued",
    configuration: input.configuration,
    stages: Object.fromEntries(STAGE_ORDER.map((stage) => [stage, { status: "queued", attempts: 0 }])),
    budgets: input.budgets,
    budgetUsage: { networkIterations: 0, stageCorrectionAttempts: 0, providerRetries: 0 },
    createdAt: now,
    updatedAt: now,
  });
}

const lifecycleTransitions: Readonly<Record<PostStatus, readonly PostStatus[]>> = {
  queued: ["researching", "failed"],
  researching: ["verifying", "failed"],
  verifying: ["writing", "failed"],
  writing: ["editing", "failed"],
  editing: ["illustrating", "failed"],
  illustrating: ["publishing", "failed"],
  publishing: ["done", "failed"],
  done: [],
  failed: [],
};

export const lifecycleTransitionSchema = z.object({ from: postStatusSchema, to: postStatusSchema }).strict();

export function isLegalTransition(from: PostStatus, to: PostStatus): boolean {
  return lifecycleTransitions[from]?.includes(to) ?? false;
}

function requireOutput(state: NetworkState, output: "evidence" | "article" | "image"): void {
  if (!state[output]) throw new Error(`Cannot advance without ${output}.`);
}

function requireSupportedEvidence(state: NetworkState): void {
  requireOutput(state, "evidence");
  if (!state.evidence?.findings.some((finding) => finding.verdict === "supported")) {
    throw new Error("Cannot advance without supported evidence.");
  }
}

function advanceStage(state: NetworkState, previous: StageName, next: StageName, at: string): NetworkState["stages"] {
  const completed = completeStage(state.stages, previous, at);
  return activateStage(completed, next, at);
}

export type TransitionOptions = Readonly<{ at?: string; failure?: unknown }>;

/** Enforce the sequential lifecycle and validate all newly reachable outputs. */
export function transitionState(value: unknown, next: PostStatus, options: TransitionOptions = {}): NetworkState {
  const state = networkStateSchema.parse(value);
  postStatusSchema.parse(next);
  if (!isLegalTransition(state.status, next)) throw new Error(`Illegal lifecycle transition from ${state.status} to ${next}.`);
  const at = timestamp(options.at);
  if (next === "failed") {
    const failure = publicErrorSchema.parse(options.failure);
    const active = currentStage(state.stages);
    const stages = active ? failStage(state.stages, active, at) : state.stages;
    return networkStateSchema.parse({ ...state, status: next, stages, failure, updatedAt: at });
  }

  let stages = state.stages;
  if (state.status === "queued" && next === "researching") {
    stages = activateStage(stages, "research", at);
  } else if (state.status === "researching" && next === "verifying") {
    requireOutput(state, "evidence");
    stages = advanceStage(state, "research", "verify", at);
  } else if (state.status === "verifying" && next === "writing") {
    requireSupportedEvidence(state);
    stages = advanceStage(state, "verify", "write", at);
  } else if (state.status === "writing" && next === "editing") {
    requireOutput(state, "article");
    stages = advanceStage(state, "write", "edit", at);
  } else if (state.status === "editing" && next === "illustrating") {
    requireOutput(state, "article");
    stages = advanceStage(state, "edit", "illustrate", at);
  } else if (state.status === "illustrating" && next === "publishing") {
    requireOutput(state, "image");
    stages = advanceStage(state, "illustrate", "publish", at);
  } else if (state.status === "publishing" && next === "done") {
    requireSupportedEvidence(state);
    requireOutput(state, "article");
    requireOutput(state, "image");
    stages = completeStage(stages, "publish", at);
  }
  return networkStateSchema.parse({ ...state, status: next, stages, updatedAt: at });
}

export type BudgetName = keyof BudgetUsage;

const budgetLimitKey: Readonly<Record<BudgetName, keyof NetworkBudget>> = {
  networkIterations: "networkMaxIterations",
  stageCorrectionAttempts: "stageCorrectionAttempts",
  providerRetries: "providerRetries",
};

export function hasRemainingBudget(value: unknown, budget: BudgetName): boolean {
  const state = networkStateSchema.parse(value);
  return state.budgetUsage[budget] < state.budgets[budgetLimitKey[budget]];
}

export function consumeBudget(value: unknown, budget: BudgetName): NetworkState {
  const state = networkStateSchema.parse(value);
  if (!hasRemainingBudget(state, budget)) throw new Error(`${budget} budget is exhausted.`);
  const usage = { ...state.budgetUsage, [budget]: state.budgetUsage[budget] + 1 };
  return networkStateSchema.parse({ ...state, budgetUsage: usage });
}

export function parseState(value: unknown): NetworkState {
  return networkStateSchema.parse(value);
}

export const reconstructState = parseState;

export function serializeState(value: unknown): string {
  const state = networkStateSchema.parse(value);
  const serialized = JSON.stringify(state);
  if (serialized.length > STATE_LIMITS.maxSerializedChars) throw new Error("Serialized network state exceeds the maximum size.");
  return serialized;
}

export function deserializeState(value: unknown): NetworkState {
  if (typeof value !== "string" || value.length > STATE_LIMITS.maxSerializedChars) throw new Error("Serialized network state is invalid or too large.");
  try {
    return networkStateSchema.parse(JSON.parse(value));
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw new Error("Serialized network state is not valid JSON.");
  }
}

export const serializeNetworkState = serializeState;
export const deserializeNetworkState = deserializeState;

