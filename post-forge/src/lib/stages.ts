import { z } from "zod";
import { stageNameSchema, stageStatusSchema, stagesSchema, type StageName, type StageState } from "./contracts/post";

export type { StageName } from "./contracts/post";

export const STAGE_ORDER = ["research", "verify", "write", "edit", "illustrate", "publish"] as const satisfies readonly StageName[];

export const stageTransitionSchema = z.object({
  from: stageStatusSchema,
  to: stageStatusSchema,
}).strict();

const allowedTransitions: Readonly<Record<z.infer<typeof stageStatusSchema>, readonly z.infer<typeof stageStatusSchema>[]>> = {
  queued: ["active", "failed"],
  active: ["retrying", "done", "failed"],
  retrying: ["active", "failed"],
  done: [],
  failed: [],
};

const isoDate = z.string().datetime({ offset: true }).max(64);

export const initialStageState: StageState = Object.freeze({ status: "queued", attempts: 0 });

export function createInitialStages(): z.infer<typeof stagesSchema> {
  return stagesSchema.parse(Object.fromEntries(STAGE_ORDER.map((stage) => [stage, { ...initialStageState }])));
}

function ensureStage(stage: string): asserts stage is StageName {
  stageNameSchema.parse(stage);
}

function ensureTime(at?: string): string {
  const value = at ?? new Date().toISOString();
  return isoDate.parse(value);
}

/** Apply one legal stage-level transition and return a new stage map. */
export function transitionStage(
  stages: unknown,
  stage: StageName,
  next: z.infer<typeof stageStatusSchema>,
  at?: string,
): z.infer<typeof stagesSchema> {
  const parsed = stagesSchema.parse(stages);
  ensureStage(stage);
  const current = parsed[stage];
  if (!allowedTransitions[current.status].includes(next)) {
    throw new Error(`Illegal ${stage} transition from ${current.status} to ${next}.`);
  }
  const timestamp = ensureTime(at);
  let updated: StageState;
  if (next === "active") {
    const attempts = current.attempts + 1;
    if (attempts > 4) throw new Error(`Stage ${stage} has exhausted its attempt budget.`);
    updated = { status: "active", attempts, startedAt: timestamp };
  } else if (next === "retrying") {
    updated = { ...current, status: "retrying", endedAt: timestamp };
  } else if (next === "done" || next === "failed") {
    if (!current.startedAt) throw new Error(`Stage ${stage} must start before it can be ${next}.`);
    updated = { ...current, status: next, endedAt: timestamp };
  } else {
    updated = { ...current, status: next };
  }
  return stagesSchema.parse({ ...parsed, [stage]: updated });
}

export function activateStage(stages: unknown, stage: StageName, at?: string) {
  return transitionStage(stages, stage, "active", at);
}

export function retryStage(stages: unknown, stage: StageName, at?: string) {
  return transitionStage(stages, stage, "retrying", at);
}

export function completeStage(stages: unknown, stage: StageName, at?: string) {
  return transitionStage(stages, stage, "done", at);
}

export function failStage(stages: unknown, stage: StageName, at?: string) {
  return transitionStage(stages, stage, "failed", at);
}

export function isTerminalStage(stage: StageState): boolean {
  return stage.status === "done" || stage.status === "failed";
}

export function currentStage(stages: unknown): StageName | undefined {
  const parsed = stagesSchema.parse(stages);
  return STAGE_ORDER.find((stage) => parsed[stage].status === "active" || parsed[stage].status === "retrying");
}
