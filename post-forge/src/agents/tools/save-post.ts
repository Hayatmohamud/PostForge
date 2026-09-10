import "server-only";

import { z } from "zod";
import { articleSchema, posterSchema, type Article } from "../../lib/contracts/post";
import { evidenceBundleSchema, generatedIdSchema, type EvidenceBundle } from "../../lib/contracts/evidence";
import { AppError } from "../../lib/errors";
import {
  checkpointPost,
  finalizePost,
  getPost,
  type PostCheckpoint,
  type PostSnapshot,
} from "../../lib/posts";

type Environment = Readonly<Record<string, string | undefined>>;

const savePostInputSchema = z.object({
  postId: generatedIdSchema,
  runId: generatedIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  article: articleSchema,
  evidence: evidenceBundleSchema,
  poster: posterSchema,
}).strict();

export type SavePostInput = z.infer<typeof savePostInputSchema>;
export type SavePostDependencies = Readonly<{
  getPost?: typeof getPost;
  checkpointPost?: typeof checkpointPost;
  finalizePost?: typeof finalizePost;
}>;

function invalid(): never {
  throw new AppError("INVALID_INPUT");
}

function deriveCitations(article: Article, evidence: EvidenceBundle): Article {
  const findings = new Map(evidence.findings.map((finding) => [finding.findingId, finding]));
  const sources = new Map(evidence.sources.map((source) => [source.sourceId, source]));
  const used = new Set<string>();

  for (const block of article.body) {
    for (const findingId of block.findingIds) {
      const finding = findings.get(findingId);
      if (!finding || finding.verdict !== "supported") invalid();
      used.add(finding.sourceId);
    }
    for (const sourceId of block.sourceIds) {
      if (!sources.has(sourceId)) invalid();
      used.add(sourceId);
    }
  }

  if (!used.size || !article.body.some((block) => block.findingIds.some((findingId) => findings.get(findingId)?.verdict === "supported"))) {
    invalid();
  }

  return {
    ...article,
    citedSources: [...used].map((sourceId) => {
      const source = sources.get(sourceId);
      if (!source) invalid();
      return { sourceId: source.sourceId, url: source.url, title: source.title };
    }),
  };
}

function validateInput(value: unknown): SavePostInput {
  const parsed = savePostInputSchema.safeParse(value);
  if (!parsed.success) throw new AppError("INVALID_INPUT");
  if (parsed.data.poster.postId !== parsed.data.postId || parsed.data.poster.gridFsId !== parsed.data.poster.posterId) {
    throw new AppError("INVALID_INPUT");
  }
  return parsed.data;
}

/** Persist all generated outputs, then finalize the post exactly once. */
export async function savePost(
  value: unknown,
  dependencies: SavePostDependencies = {},
  env?: Environment,
): Promise<PostSnapshot> {
  const input = validateInput(value);
  const load = dependencies.getPost ?? getPost;
  const checkpoint = dependencies.checkpointPost ?? checkpointPost;
  const finalize = dependencies.finalizePost ?? finalizePost;
  const current = await load(input.postId, env);
  if (!current || current.post.runId !== input.runId) invalid();
  if (current.post.status === "done") return current;
  if (current.revision !== input.revision) invalid();

  const article = deriveCitations(input.article, input.evidence);
  const next: PostCheckpoint = {
    status: "publishing",
    stages: current.post.stages,
    outputs: { ...current.post.outputs, evidence: input.evidence, article, poster: input.poster },
  };
  const saved = await checkpoint(input.postId, input.revision, next, env);
  if (!saved) invalid();
  const completed = await finalize(input.postId, saved.revision, env);
  if (!completed) invalid();
  return completed;
}

export const savePostInput = savePostInputSchema;
