import "server-only";

import { z } from "zod";
import { generatePoster, type GeneratePosterInput, type PosterGenerationDependencies, type PosterReference } from "./tools/generate-poster";
import { articleSchema, type Article } from "../lib/contracts/post";
import { createTextModel, type SavedModelSelection, type TextModel } from "../lib/models";
import { generatedIdSchema } from "../lib/contracts/evidence";

const PROMPT_MAX_CHARS = 8_000;
const imageConfigSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().min(1).max(2_000),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  maxBytes: z.number().int().min(1).max(20_971_520).optional(),
}).strict();
const illustratorInputSchema = z.object({
  postId: generatedIdSchema,
  runId: generatedIdSchema,
  article: articleSchema,
  imageConfig: imageConfigSchema,
  existingPosterId: generatedIdSchema.optional(),
}).strict();

export type IllustratorInput = z.infer<typeof illustratorInputSchema>;
export type IllustratorDependencies = Readonly<{
  generatePoster?: typeof generatePoster;
  posterDependencies?: PosterGenerationDependencies;
  model?: TextModel;
  selection?: SavedModelSelection;
}>;
export type IllustratorResult = Readonly<{ status: "complete" | "invalid_input"; poster?: PosterReference }>;

function derivePrompt(article: Article): string {
  const clean = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  const body = clean(article.body.map((block) => block.text).join(" "));
  const prompt = [
    "Create a clean editorial illustration for a social post.",
    `Title: ${clean(article.title)}`,
    `Themes: ${body}`,
    "Use a clear visual metaphor, strong composition, and no readable text, logos, or unsupported factual symbols.",
  ].join(" ");
  return prompt.slice(0, PROMPT_MAX_CHARS).trim();
}

/** Construct the shared text model for future bounded prompt inference. */
export function createIllustratorModel(dependencies: Pick<IllustratorDependencies, "model" | "selection"> = {}): TextModel {
  return dependencies.model ?? createTextModel(dependencies.selection);
}

/** Generate and persist a poster only after the existing poster tool succeeds. */
export async function illustrate(value: unknown, dependencies: IllustratorDependencies = {}): Promise<IllustratorResult> {
  const input = illustratorInputSchema.safeParse(value);
  if (!input.success) return { status: "invalid_input" };
  const prompt = derivePrompt(input.data.article);
  if (!prompt) return { status: "invalid_input" };
  const generate = dependencies.generatePoster ?? generatePoster;
  const poster = await generate({
    postId: input.data.postId,
    runId: input.data.runId,
    prompt,
    imageConfig: input.data.imageConfig,
    existingPosterId: input.data.existingPosterId,
  } satisfies GeneratePosterInput, dependencies.posterDependencies);
  return { status: "complete", poster };
}

export const runIllustrator = illustrate;
export const illustratorInput = illustratorInputSchema;
