import "server-only";

import { z } from "zod";
import { editArticle, type EditorResult } from "./editor";
import { illustrate, type IllustratorResult } from "./illustrator";
import { publishPost, type PublisherResult } from "./publisher";
import { research, type ResearchResult } from "./research";
import { routeStage, type StageRoute } from "./router";
import { routeVerification, type VerificationPolicyResult } from "./verification-policy";
import { verify, type VerifyResult } from "./verify";
import { writeArticle, type WriterResult } from "./writer";
import {
  consumeBudget,
  networkStateSchema,
  transitionState,
  type NetworkState,
} from "../lib/state";
import { getServerConfig, type ServerConfig } from "../lib/config";
import { evidenceBundleSchema } from "../lib/contracts/evidence";
import { posterSchema, type Poster } from "../lib/contracts/post";
import { type PostSnapshot } from "../lib/posts";
import type { SavedModelSelection } from "../lib/models";

type Environment = Readonly<Record<string, string | undefined>>;

const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const networkRequestSchema = z.object({
  state: networkStateSchema,
  revision: revisionSchema.optional(),
}).strict();

export type NetworkRequest = Readonly<{ state: NetworkState; revision: number }>;
export type NetworkDependencies = Readonly<{
  research?: typeof research;
  verify?: typeof verify;
  writer?: typeof writeArticle;
  editor?: typeof editArticle;
  illustrator?: typeof illustrate;
  publisher?: typeof publishPost;
  verificationPolicy?: typeof routeVerification;
  stageRouter?: typeof routeStage;
  getServerConfig?: typeof getServerConfig;
  serverConfig?: ServerConfig;
  imageConfig?: (state: NetworkState) => { provider: string; model: string; apiKey: string; timeoutMs?: number; maxBytes?: number };
  env?: Environment;
  now?: () => string;
}>;
export type NetworkResult = Readonly<
  | { status: "complete"; state: NetworkState; post?: PostSnapshot }
  | { status: "failed"; state: NetworkState; reason: string }
  | { status: "invalid_input"; reason: string }
>;
export type NetworkRunner = Readonly<{ run: (value: unknown) => Promise<NetworkResult> }>;

function parseRequest(value: unknown): NetworkRequest | null {
  const envelope = networkRequestSchema.safeParse(value);
  if (envelope.success) return { state: envelope.data.state, revision: envelope.data.revision ?? 0 };
  const state = networkStateSchema.safeParse(value);
  return state.success ? { state: state.data, revision: 0 } : null;
}

function timestamp(dependencies: NetworkDependencies): string {
  return dependencies.now?.() ?? new Date().toISOString();
}

function failureState(
  state: NetworkState,
  reason: string,
  stage: "research" | "verify" | "write" | "edit" | "illustrate" | "publish",
  dependencies: NetworkDependencies,
  code: "INSUFFICIENT_EVIDENCE" | "TERMINAL_FAILURE" = "TERMINAL_FAILURE",
): NetworkResult {
  if (state.status === "failed") return { status: "failed", state, reason };
  const failed = transitionState(state, "failed", {
    at: timestamp(dependencies),
    failure: {
      code,
      message: reason,
      status: code === "INSUFFICIENT_EVIDENCE" ? 422 : 500,
      retryable: false,
      postId: state.postId,
      stage,
    },
  });
  return { status: "failed", state: failed, reason };
}

function routeOrThrow(state: NetworkState, nextStatus: Parameters<typeof transitionState>[1], router: typeof routeStage): void {
  const route: StageRoute = router(state);
  if (nextStatus === "done") {
    if (route.status !== "terminal" || route.nextStatus !== "done") throw new Error("Router rejected completion.");
    return;
  }
  if (route.status !== "advance" || route.nextStatus !== nextStatus) throw new Error("Router rejected lifecycle order.");
}

function advance(
  state: NetworkState,
  nextStatus: Parameters<typeof transitionState>[1],
  dependencies: NetworkDependencies,
): NetworkState {
  const router = dependencies.stageRouter ?? routeStage;
  routeOrThrow(state, nextStatus, router);
  const counted = consumeBudget(state, "networkIterations");
  return transitionState(counted, nextStatus, { at: timestamp(dependencies) });
}

function finish(state: NetworkState, dependencies: NetworkDependencies): NetworkState {
  return transitionState(state, "done", { at: timestamp(dependencies) });
}

function posterFromIllustrator(value: IllustratorResult, postId: string): Poster | null {
  if (value.status !== "complete" || !value.poster || value.poster.postId !== postId) return null;
  return posterSchema.safeParse({
    posterId: value.poster.id,
    gridFsId: value.poster.id,
    postId: value.poster.postId,
    stage: value.poster.stage,
    mediaType: value.poster.mediaType,
    byteSize: value.poster.byteSize,
    completedAt: value.poster.completedAt,
  }).success ? {
    posterId: value.poster.id,
    gridFsId: value.poster.id,
    postId: value.poster.postId,
    stage: value.poster.stage,
    mediaType: value.poster.mediaType,
    byteSize: value.poster.byteSize,
    completedAt: value.poster.completedAt,
  } : null;
}

function modelDependencies(state: NetworkState, dependencies: NetworkDependencies) {
  return { selection: state.configuration.model as SavedModelSelection, env: dependencies.env };
}

function imageConfig(state: NetworkState, dependencies: NetworkDependencies) {
  const config = dependencies.serverConfig ?? (dependencies.getServerConfig ?? getServerConfig)(dependencies.env);
  return {
    provider: state.configuration.image.provider,
    model: state.configuration.image.model,
    apiKey: config.image.apiKey,
    timeoutMs: config.limits.imageTimeoutMs,
    maxBytes: config.limits.posterMaxBytes,
  };
}

async function execute(request: NetworkRequest, dependencies: NetworkDependencies): Promise<NetworkResult> {
  let state = request.state;
  let stage: "research" | "verify" | "write" | "edit" | "illustrate" | "publish" = "research";
  let published: PostSnapshot | undefined;

  if (state.status === "done") return { status: "complete", state };
  if (state.status === "failed") return { status: "failed", state, reason: state.failure?.message ?? "Workflow has failed." };
  if (!state.runId) return failureState(state, "Network requires the current run identity.", stage, dependencies);

  try {
    if (state.status === "queued") state = advance(state, "researching", dependencies);

    if (state.status === "researching") {
      stage = "research";
      if (!state.evidence) {
        const researched: ResearchResult = await (dependencies.research ?? research)(state.topic, modelDependencies(state, dependencies));
        if (researched.status !== "complete" || !researched.findings.length) {
          return failureState(state, "Research did not produce supported source-linked findings.", stage, dependencies, "INSUFFICIENT_EVIDENCE");
        }
        const verified: VerifyResult = await (dependencies.verify ?? verify)({
          sources: [...researched.sources],
          findings: [...researched.findings],
        }, modelDependencies(state, dependencies));
        if (verified.status === "invalid_output") {
          return failureState(state, "Verification returned invalid output.", "verify", dependencies);
        }
        state = networkStateSchema.parse({ ...state, evidence: evidenceBundleSchema.parse(verified.evidence) });
      }
      state = advance(state, "verifying", dependencies);
    }

    if (state.status === "verifying") {
      stage = "verify";
      if (!state.evidence) return failureState(state, "Verification requires an evidence bundle.", stage, dependencies);
      const policy: VerificationPolicyResult = (dependencies.verificationPolicy ?? routeVerification)(state.evidence);
      if (policy.status !== "writer_ready") {
        return failureState(state, "Verification found insufficient supported evidence.", stage, dependencies, "INSUFFICIENT_EVIDENCE");
      }
      state = advance(state, "writing", dependencies);
    }

    if (state.status === "writing") {
      stage = "write";
      if (!state.evidence) return failureState(state, "Writing requires verified evidence.", stage, dependencies);
      if (!state.article) {
        const policy = (dependencies.verificationPolicy ?? routeVerification)(state.evidence);
        if (policy.status !== "writer_ready") return failureState(state, "Writing requires supported evidence.", stage, dependencies, "INSUFFICIENT_EVIDENCE");
        const written: WriterResult = await (dependencies.writer ?? writeArticle)({ topic: state.topic, evidence: policy.evidence }, modelDependencies(state, dependencies));
        if (written.status !== "complete" || !written.article) return failureState(state, "Writer returned no valid article.", stage, dependencies);
        state = networkStateSchema.parse({ ...state, article: written.article });
      }
      state = advance(state, "editing", dependencies);
    }

    if (state.status === "editing") {
      stage = "edit";
      if (!state.evidence || !state.article) return failureState(state, "Editing requires article and evidence outputs.", stage, dependencies);
      const edited: EditorResult = await (dependencies.editor ?? editArticle)({ article: state.article, evidence: state.evidence }, modelDependencies(state, dependencies));
      if (edited.status !== "complete" || !edited.article) return failureState(state, "Editor returned no valid article.", stage, dependencies);
      state = networkStateSchema.parse({ ...state, article: edited.article });
      state = advance(state, "illustrating", dependencies);
    }

    if (state.status === "illustrating") {
      stage = "illustrate";
      if (!state.article) return failureState(state, "Illustration requires an article output.", stage, dependencies);
      if (!state.image) {
        const illustrator = dependencies.illustrator ?? illustrate;
        const illustrated: IllustratorResult = await illustrator({
          postId: state.postId,
          runId: state.runId,
          article: state.article,
          imageConfig: dependencies.imageConfig?.(state) ?? imageConfig(state, dependencies),
        });
        const image = posterFromIllustrator(illustrated, state.postId);
        if (!image) return failureState(state, "Illustrator returned no valid poster.", stage, dependencies);
        state = networkStateSchema.parse({ ...state, image });
      }
      state = advance(state, "publishing", dependencies);
    }

    if (state.status === "publishing") {
      stage = "publish";
      if (!state.runId || !state.evidence || !state.article || !state.image) return failureState(state, "Publishing requires the current run and validated outputs.", stage, dependencies);
      const result: PublisherResult = await (dependencies.publisher ?? publishPost)({
        postId: state.postId,
        runId: state.runId,
        revision: request.revision,
        article: state.article,
        evidence: state.evidence,
        poster: state.image,
      }, { env: dependencies.env });
      if (result.status !== "published") return failureState(state, "Publisher did not confirm persistence.", stage, dependencies);
      published = result.post;
      state = finish(state, dependencies);
    }

    if (!published) return failureState(state, "Network ended without confirmed publication.", stage, dependencies);
    return { status: "complete", state, post: published };
  } catch {
    return failureState(state, "Network stage failed before a confirmed publication.", stage, dependencies);
  }
}

/** Build the bounded six-stage network runner around the saved state and configuration. */
export function createNetwork(dependencies: NetworkDependencies = {}): NetworkRunner {
  return Object.freeze({ run: (value: unknown) => runNetwork(value, dependencies) });
}

export async function runNetwork(value: unknown, dependencies: NetworkDependencies = {}): Promise<NetworkResult> {
  const request = parseRequest(value);
  if (!request) return { status: "invalid_input", reason: "Saved network state failed validation." };
  return execute(request, dependencies);
}

export const createAgentNetwork = createNetwork;
export const runAgentNetwork = runNetwork;
export const networkInput = networkRequestSchema;
