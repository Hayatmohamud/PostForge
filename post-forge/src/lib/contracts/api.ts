import { z } from "zod";
import {
  articleSchema,
  postCreateSchema,
  postSchema,
  postStatusSchema,
  publicErrorSchema,
  stageNameSchema,
  stagesSchema,
} from "./post";
import { generatedIdSchema, referenceIdSchema, sourceReferenceSchema, verdictSchema } from "./evidence";

export const API_LIMITS = Object.freeze({ maxPageSize: 50, maxCursorChars: 256 });

export const generateRequestSchema = postCreateSchema;
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const generateResponseSchema = z.object({
  postId: generatedIdSchema,
}).strict();

const publicFindingSchema = z.object({
  findingId: referenceIdSchema,
  claim: z.string().min(1).max(2_000),
  sourceId: referenceIdSchema,
  verdict: verdictSchema,
  rationale: z.string().min(1).max(4_000),
}).strict();

/** Public evidence deliberately excludes fetched page text. */
export const publicEvidenceSchema = z.object({
  findings: z.array(publicFindingSchema).max(100),
  sources: z.array(sourceReferenceSchema).max(100),
}).strict();

export const publicPosterSchema = z.object({
  posterId: generatedIdSchema,
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().min(1).max(20_971_520),
  completedAt: z.string().datetime({ offset: true }).max(64),
}).strict();

export const postListItemSchema = z.object({
  postId: generatedIdSchema,
  topic: z.string().min(1).max(2_000),
  status: postStatusSchema,
  posterId: generatedIdSchema.optional(),
  createdAt: z.string().datetime({ offset: true }).max(64),
  updatedAt: z.string().datetime({ offset: true }).max(64),
}).strict();

export const postDetailDtoSchema = z.object({
  postId: generatedIdSchema,
  topic: z.string().min(1).max(2_000),
  status: postStatusSchema,
  stages: stagesSchema,
  article: articleSchema.optional(),
  evidence: publicEvidenceSchema.optional(),
  poster: publicPosterSchema.optional(),
  error: publicErrorSchema.optional(),
  createdAt: z.string().datetime({ offset: true }).max(64),
  updatedAt: z.string().datetime({ offset: true }).max(64),
}).strict();

export type PostListItem = z.infer<typeof postListItemSchema>;
export type PublicEvidence = z.infer<typeof publicEvidenceSchema>;
export type PublicPoster = z.infer<typeof publicPosterSchema>;
export type PostDetailDto = z.infer<typeof postDetailDtoSchema>;

export const postResponseSchema = z.object({ post: postDetailDtoSchema }).strict();
export const postsResponseSchema = z.object({
  posts: z.array(postListItemSchema).max(API_LIMITS.maxPageSize),
  nextCursor: z.string().min(1).max(API_LIMITS.maxCursorChars).optional(),
}).strict();
export const errorResponseSchema = z.object({ error: publicErrorSchema }).strict();

export type GenerateResponse = z.infer<typeof generateResponseSchema>;
export type PostResponse = z.infer<typeof postResponseSchema>;
export type PostsResponse = z.infer<typeof postsResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Convert a persisted post into the browser-safe detail DTO. */
export function toPublicPost(value: unknown): PostDetailDto {
  const post = postSchema.parse(value);
  const dto: PostDetailDto = {
    postId: post.postId,
    topic: post.topic,
    status: post.status,
    stages: post.stages,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
  if (post.outputs.article) dto.article = post.outputs.article;
  if (post.outputs.evidence) {
    dto.evidence = {
      findings: post.outputs.evidence.findings.map(({ findingId, claim, sourceId, verdict, rationale }) => ({ findingId, claim, sourceId, verdict, rationale })),
      sources: post.outputs.evidence.sources.map(({ sourceId, url, title }) => ({ sourceId, url, title })),
    };
  }
  if (post.outputs.poster) {
    dto.poster = {
      posterId: post.outputs.poster.posterId,
      mediaType: post.outputs.poster.mediaType,
      byteSize: post.outputs.poster.byteSize,
      completedAt: post.outputs.poster.completedAt,
    };
  }
  if (post.error) dto.error = post.error;
  return postDetailDtoSchema.parse(dto);
}

export const toPublicPostDto = toPublicPost;

export function toPostListItem(value: unknown): PostListItem {
  const post = postSchema.parse(value);
  return postListItemSchema.parse({
    postId: post.postId,
    topic: post.topic,
    status: post.status,
    ...(post.posterId ? { posterId: post.posterId } : {}),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  });
}

export const stageRouteSchema = z.object({ id: generatedIdSchema, stage: stageNameSchema }).strict();
