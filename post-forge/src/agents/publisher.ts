import "server-only";

import { z } from "zod";
import { evidenceBundleSchema, generatedIdSchema } from "../lib/contracts/evidence";
import { articleSchema, posterSchema, type Poster } from "../lib/contracts/post";
import { type PostSnapshot } from "../lib/posts";
import { savePost } from "./tools/save-post";

type Environment = Readonly<Record<string, string | undefined>>;

const posterReferenceSchema = z.object({
  id: generatedIdSchema,
  postId: generatedIdSchema,
  stage: z.literal("illustrate"),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().min(1).max(20_971_520),
  completedAt: z.string().datetime({ offset: true }).max(64),
}).strict();

const publisherInputSchema = z.object({
  postId: generatedIdSchema,
  runId: generatedIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  article: articleSchema.optional(),
  evidence: evidenceBundleSchema.optional(),
  poster: z.union([posterSchema, posterReferenceSchema]).optional(),
}).strict();

export type PublisherInput = z.infer<typeof publisherInputSchema>;
export type PublisherDependencies = Readonly<{
  savePost?: typeof savePost;
  env?: Environment;
}>;
export type PublisherResult = Readonly<
  | { status: "published"; post: PostSnapshot }
  | { status: "incomplete" }
  | { status: "invalid_input" }
  | { status: "failed" }
>;

function normalizePoster(value: PublisherInput["poster"], postId: string): Poster | null {
  if (!value || value.postId !== postId) return null;
  if ("posterId" in value) return value;
  return {
    posterId: value.id,
    gridFsId: value.id,
    postId: value.postId,
    stage: value.stage,
    mediaType: value.mediaType,
    byteSize: value.byteSize,
    completedAt: value.completedAt,
  };
}

/** Persist the validated pipeline outputs; this agent never publishes to a social network. */
export async function publishPost(value: unknown, dependencies: PublisherDependencies = {}): Promise<PublisherResult> {
  const parsed = publisherInputSchema.safeParse(value);
  if (!parsed.success) return { status: "invalid_input" };
  const { postId, runId, revision, article, evidence, poster } = parsed.data;
  const normalizedPoster = normalizePoster(poster, postId);
  if (!article || !evidence || !normalizedPoster) return { status: "incomplete" };

  try {
    const post = await (dependencies.savePost ?? savePost)({
      postId,
      runId,
      revision,
      article,
      evidence,
      poster: normalizedPoster,
    }, undefined, dependencies.env);
    return { status: "published", post };
  } catch {
    return { status: "failed" };
  }
}

export const runPublisher = publishPost;
export const publisherInput = publisherInputSchema;
