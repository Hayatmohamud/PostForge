import "server-only";

import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { networkStateSchema, STATE_LIMITS, type NetworkState } from "../lib/state";
import { STAGE_ORDER } from "../lib/stages";

const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const checkpointReasonSchema = z.enum(["start", "stage_started", "stage_completed", "retrying", "output", "failed", "completed"]);
export const checkpointWriteSchema = z.object({
  state: networkStateSchema,
  expectedRevision: revisionSchema.optional(),
  reason: checkpointReasonSchema,
  activity: z.string().optional(),
}).strict();

export type CheckpointReason = z.infer<typeof checkpointReasonSchema>;
export type CheckpointWrite = z.input<typeof checkpointWriteSchema>;
export type CheckpointSnapshot = Readonly<{
  revision: number;
  postId: string;
  runId?: string;
  state: NetworkState;
  reason: CheckpointReason;
  activity?: string;
}>;
export type CheckpointStore = Readonly<{
  load: (postId: string, runId?: string) => Promise<CheckpointSnapshot | null>;
  save: (value: unknown) => Promise<CheckpointSnapshot | null>;
}>;

const statusRank: Readonly<Record<NetworkState["status"], number>> = {
  queued: 0,
  researching: 1,
  verifying: 2,
  writing: 3,
  editing: 4,
  illustrating: 5,
  publishing: 6,
  done: 7,
  failed: 8,
};

/** Remove control characters and bound provider activity before it reaches persistence/UI. */
export function safeActivitySummary(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, STATE_LIMITS.maxActivityChars);
  return clean || undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key(postId: string, runId?: string): string {
  return `${postId}:${runId ?? ""}`;
}

function withActivity(state: NetworkState, activity: string | undefined): NetworkState {
  if (!activity) return state;
  const active = STAGE_ORDER.find((stage) => state.stages[stage].status === "active" || state.stages[stage].status === "retrying");
  if (!active) return state;
  return networkStateSchema.parse({ ...state, stages: { ...state.stages, [active]: { ...state.stages[active], activity } } });
}

function immutableCompletedOutputs(current: NetworkState, next: NetworkState): boolean {
  for (const stage of STAGE_ORDER) {
    const previous = current.stages[stage];
    if ((previous.status === "done" || previous.status === "failed") && !isDeepStrictEqual(previous, next.stages[stage])) return false;
  }
  if (current.stages.verify.status === "done" && !isDeepStrictEqual(current.evidence, next.evidence)) return false;
  if (current.stages.edit.status === "done" && !isDeepStrictEqual(current.article, next.article)) return false;
  if (current.stages.illustrate.status === "done" && !isDeepStrictEqual(current.image, next.image)) return false;
  return true;
}

function canAdvance(current: NetworkState, next: NetworkState): boolean {
  if (current.postId !== next.postId || current.runId !== next.runId) return false;
  if (statusRank[next.status] < statusRank[current.status]) return false;
  if (current.status === "done" || current.status === "failed") return current.status === next.status && isDeepStrictEqual(current, next);
  return immutableCompletedOutputs(current, next);
}

/** A compare-and-swap store suitable for tests and replaceable by a durable adapter. */
export function createMemoryCheckpointStore(): CheckpointStore {
  const records = new Map<string, CheckpointSnapshot>();
  return {
    async load(postId, runId) {
      const current = records.get(key(postId, runId));
      return current ? clone(current) : null;
    },
    async save(value) {
      const parsed = checkpointWriteSchema.parse(value);
      const activity = safeActivitySummary(parsed.activity);
      const state = withActivity(parsed.state, activity);
      const recordKey = key(state.postId, state.runId);
      const current = records.get(recordKey);
      if (current && parsed.expectedRevision !== current.revision) return null;
      if (!current && parsed.expectedRevision !== undefined) return null;
      if (current && !canAdvance(current.state, state)) return null;
      if (current && (current.state.status === "done" || current.state.status === "failed")) return clone(current);
      const next: CheckpointSnapshot = Object.freeze({
        revision: current ? current.revision + 1 : 0,
        postId: state.postId,
        ...(state.runId ? { runId: state.runId } : {}),
        state: clone(state),
        reason: parsed.reason,
        ...(activity ? { activity } : {}),
      });
      records.set(recordKey, next);
      return clone(next);
    },
  };
}

export const createInMemoryCheckpointStore = createMemoryCheckpointStore;
export const checkpointSchema = checkpointWriteSchema;
export const sanitizeActivity = safeActivitySummary;
