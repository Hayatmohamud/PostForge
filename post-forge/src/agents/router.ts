import { z } from "zod";
import {
  networkStateSchema,
  type NetworkState,
} from "../lib/state";
import type { PostStatus, StageName } from "../lib/contracts/post";

const routeSchema = z.object({
  status: z.enum(["advance", "terminal", "blocked", "invalid_input"]),
  nextStatus: z.enum(["researching", "verifying", "writing", "editing", "illustrating", "publishing", "done", "failed"]).optional(),
  nextStage: z.enum(["research", "verify", "write", "edit", "illustrate", "publish"]).optional(),
  reason: z.string().optional(),
}).strict();

export type StageRoute = z.infer<typeof routeSchema>;

function completeDeliverable(state: NetworkState): boolean {
  return Boolean(
    state.evidence?.findings.some((finding) => finding.verdict === "supported") &&
    state.article?.body.length &&
    state.image?.byteSize,
  );
}

function advance(nextStatus: PostStatus, nextStage: StageName): StageRoute {
  return routeSchema.parse({ status: "advance", nextStatus, nextStage });
}

/** Select one legal next lifecycle stage, stopping on terminal or budget exhaustion. */
export function routeStage(value: unknown): StageRoute {
  const parsed = networkStateSchema.safeParse(value);
  if (!parsed.success) return { status: "invalid_input", reason: "Network state failed validation." };
  const state = parsed.data;

  if (state.status === "done" || state.status === "failed") return { status: "terminal", reason: `Workflow is already ${state.status}.` };
  if (state.budgetUsage.networkIterations >= state.budgets.networkMaxIterations) {
    return { status: "terminal", nextStatus: "failed", reason: "Network iteration budget exhausted." };
  }
  if (Object.values(state.stages).some((stage) => stage.status === "retrying") &&
      state.budgetUsage.stageCorrectionAttempts >= state.budgets.stageCorrectionAttempts) {
    return { status: "terminal", nextStatus: "failed", reason: "Stage correction budget exhausted." };
  }

  switch (state.status) {
    case "queued": return advance("researching", "research");
    case "researching":
      return state.evidence ? advance("verifying", "verify") : { status: "blocked", reason: "Research output is required before verification." };
    case "verifying":
      return state.evidence?.findings.some((finding) => finding.verdict === "supported")
        ? advance("writing", "write")
        : { status: "terminal", nextStatus: "failed", reason: "Insufficient supported evidence." };
    case "writing":
      return state.article ? advance("editing", "edit") : { status: "blocked", reason: "Writer output is required before editing." };
    case "editing":
      return state.article ? advance("illustrating", "illustrate") : { status: "blocked", reason: "Edited article is required before illustration." };
    case "illustrating":
      return state.image ? advance("publishing", "publish") : { status: "blocked", reason: "Illustration output is required before publishing." };
    case "publishing":
      return completeDeliverable(state)
        ? { status: "terminal", nextStatus: "done", reason: "All validated outputs are present." }
        : { status: "terminal", nextStatus: "failed", reason: "Publishing requires supported evidence, article content, and an image." };
  }
}

export const routeNetworkState = routeStage;
export const runStageRouter = routeStage;
