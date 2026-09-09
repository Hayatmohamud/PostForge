import { z } from "zod";
import {
  evidenceBundleSchema,
  generatedIdSchema,
  referenceIdSchema,
  submissionKeySchema,
  sourceReferenceSchema,
  type EvidenceBundle,
} from "./evidence";

export const POST_LIMITS = Object.freeze({
  maxTopicChars: 2_000,
  maxArticleChars: 200_000,
  maxTitleChars: 500,
  maxBodyBlocks: 200,
  maxBlockChars: 8_000,
  maxStages: 6,
  maxActivityChars: 500,
  maxPosterBytes: 20_971_520,
});

export const postStatusSchema = z.enum([
  "queued", "researching", "verifying", "writing", "editing", "illustrating", "publishing", "done", "failed",
]);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const stageNameSchema = z.enum(["research", "verify", "write", "edit", "illustrate", "publish"]);
export type StageName = z.infer<typeof stageNameSchema>;

export const stageStatusSchema = z.enum(["queued", "active", "retrying", "done", "failed"]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

const isoDateSchema = z.string().datetime({ offset: true }).max(64);
const safeProviderValue = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:/@+-]+$/);

export const modelSnapshotSchema = z.object({
  provider: safeProviderValue,
  model: safeProviderValue,
}).strict();

export const imageSnapshotSchema = z.object({
  provider: safeProviderValue,
  model: safeProviderValue,
}).strict();

export const stageStateSchema = z.object({
  status: stageStatusSchema,
  attempts: z.number().int().min(0).max(4),
  startedAt: isoDateSchema.optional(),
  endedAt: isoDateSchema.optional(),
  activity: z.string().trim().max(POST_LIMITS.maxActivityChars).optional(),
}).strict().superRefine((stage, context) => {
  if (stage.status === "active" && !stage.startedAt) {
    context.addIssue({ code: "custom", path: ["startedAt"], message: "Active stages require a start time" });
  }
  if (stage.endedAt && !stage.startedAt) {
    context.addIssue({ code: "custom", path: ["endedAt"], message: "A completed timestamp requires a start time" });
  }
  if (stage.startedAt && stage.endedAt && Date.parse(stage.endedAt) < Date.parse(stage.startedAt)) {
    context.addIssue({ code: "custom", path: ["endedAt"], message: "Stage end cannot precede stage start" });
  }
});

export const stagesSchema = z.object({
  research: stageStateSchema,
  verify: stageStateSchema,
  write: stageStateSchema,
  edit: stageStateSchema,
  illustrate: stageStateSchema,
  publish: stageStateSchema,
}).strict();

export const articleBlockSchema = z.object({
  type: z.enum(["heading", "paragraph", "list"]),
  text: z.string().trim().min(1).max(POST_LIMITS.maxBlockChars),
  findingIds: z.array(referenceIdSchema).max(100).default([]),
  sourceIds: z.array(referenceIdSchema).max(100).default([]),
}).strict();

export const articleSchema = z.object({
  title: z.string().trim().min(1).max(POST_LIMITS.maxTitleChars),
  body: z.array(articleBlockSchema).min(1).max(POST_LIMITS.maxBodyBlocks),
  citedSources: z.array(sourceReferenceSchema).max(100),
}).strict().superRefine((article, context) => {
  const citedIds = new Set<string>();
  for (const [index, source] of article.citedSources.entries()) {
    if (citedIds.has(source.sourceId)) {
      context.addIssue({ code: "custom", path: ["citedSources", index, "sourceId"], message: "Cited sources must be deduplicated" });
    }
    citedIds.add(source.sourceId);
  }
  const articleChars = article.title.length + article.body.reduce((total, block) => total + block.text.length, 0);
  if (articleChars > POST_LIMITS.maxArticleChars) {
    context.addIssue({ code: "custom", path: ["body"], message: "Article exceeds the maximum size" });
  }
});

export const posterSchema = z.object({
  posterId: generatedIdSchema,
  gridFsId: generatedIdSchema,
  postId: generatedIdSchema,
  stage: z.literal("illustrate"),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().min(1).max(POST_LIMITS.maxPosterBytes),
  completedAt: isoDateSchema,
}).strict();

export const publicErrorSchema = z.object({
  code: z.enum(["INVALID_INPUT", "CONFIGURATION_ERROR", "INSUFFICIENT_EVIDENCE", "TRANSIENT_FAILURE", "TERMINAL_FAILURE"]),
  message: z.string().min(1).max(300),
  status: z.number().int().min(400).max(599),
  retryable: z.boolean(),
  postId: generatedIdSchema.optional(),
  stage: stageNameSchema.optional(),
}).strict();

export const dispatchStateSchema = z.enum(["queued", "dispatched", "started", "failed"]);

const postOutputsSchema = z.object({
  evidence: evidenceBundleSchema.optional(),
  article: articleSchema.optional(),
  poster: posterSchema.optional(),
}).strict();

export const postSchema = z.object({
  postId: generatedIdSchema,
  submissionKey: submissionKeySchema,
  topic: z.string().trim().min(1).max(POST_LIMITS.maxTopicChars),
  status: postStatusSchema,
  dispatchState: dispatchStateSchema,
  eventId: generatedIdSchema.optional(),
  runId: generatedIdSchema.optional(),
  schemaVersion: z.literal(1),
  model: modelSnapshotSchema,
  image: imageSnapshotSchema,
  stages: stagesSchema,
  outputs: postOutputsSchema,
  posterId: generatedIdSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  error: publicErrorSchema.optional(),
}).strict().superRefine((post, context) => {
  if (post.updatedAt && Date.parse(post.updatedAt) < Date.parse(post.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "Updated time cannot precede created time" });
  }
  if (post.outputs.poster && post.outputs.poster.postId !== post.postId) {
    context.addIssue({ code: "custom", path: ["outputs", "poster", "postId"], message: "Poster belongs to another post" });
  }
  if (post.posterId && post.outputs.poster && post.posterId !== post.outputs.poster.posterId) {
    context.addIssue({ code: "custom", path: ["posterId"], message: "Poster ID does not match poster output" });
  }
  if (post.status === "done") {
    if (!post.outputs.article || !post.outputs.evidence || !post.outputs.poster) {
      context.addIssue({ code: "custom", path: ["outputs"], message: "A completed post requires article, evidence, and poster" });
    } else if (!post.outputs.evidence.findings.some((finding) => finding.verdict === "supported")) {
      context.addIssue({ code: "custom", path: ["outputs", "evidence"], message: "A completed post requires supported evidence" });
    }
  }
});

export const postCreateSchema = z.object({
  topic: z.string().trim().min(1).max(POST_LIMITS.maxTopicChars),
  submissionKey: submissionKeySchema,
}).strict();

export type ModelSnapshot = z.infer<typeof modelSnapshotSchema>;
export type ImageSnapshot = z.infer<typeof imageSnapshotSchema>;
export type StageState = z.infer<typeof stageStateSchema>;
export type ArticleBlock = z.infer<typeof articleBlockSchema>;
export type Article = z.infer<typeof articleSchema>;
export type Poster = z.infer<typeof posterSchema>;
export type Post = z.infer<typeof postSchema>;
export type PostCreate = z.infer<typeof postCreateSchema>;
export type PostOutputs = z.infer<typeof postOutputsSchema>;
export type { EvidenceBundle };

