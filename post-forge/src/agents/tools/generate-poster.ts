import { z } from "zod";
import { generateImage, type ImageProviderConfig } from "../../lib/image";
import { AppError, classifyError, type ErrorCode } from "../../lib/errors";
import { getPoster, savePoster } from "../../lib/poster-storage";
import { generatedIdSchema } from "../../lib/contracts/evidence";

const PROMPT_MAX_CHARS = 8_000;

const imageConfigSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().min(1).max(2_000),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  maxBytes: z.number().int().min(1).max(20_971_520).optional(),
}).strict();

const posterReferenceSchema = z.object({
  id: generatedIdSchema,
  postId: generatedIdSchema,
  stage: z.literal("illustrate"),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().min(1).max(20_971_520),
  completedAt: z.string().datetime({ offset: true }).max(64),
}).strict();

const generatePosterInputSchema = z.object({
  postId: generatedIdSchema,
  runId: generatedIdSchema,
  prompt: z.string().trim().min(1).max(PROMPT_MAX_CHARS).refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), "Prompt contains unsupported control characters"),
  imageConfig: imageConfigSchema,
  existingPosterId: generatedIdSchema.optional(),
}).strict();

export type GeneratePosterInput = z.infer<typeof generatePosterInputSchema>;
export type PosterReference = z.infer<typeof posterReferenceSchema>;
export type PosterGenerationPhase = "validation" | "provider" | "storage";

/** Safe failure with a phase so callers can distinguish provider/storage work. */
const phaseByError = new WeakMap<object, PosterGenerationPhase>();

export class PosterGenerationError extends AppError {
  get phase(): PosterGenerationPhase {
    return phaseByError.get(this)!;
  }

  constructor(phase: PosterGenerationPhase, code: ErrorCode) {
    super(code);
    phaseByError.set(this, phase);
  }
}

export type PosterGenerationDependencies = Readonly<{
  generateImage?: typeof generateImage;
  savePoster?: typeof savePoster;
  getPoster?: typeof getPoster;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

function failure(phase: PosterGenerationPhase, error: unknown): PosterGenerationError {
  const code = error instanceof PosterGenerationError ? error.code : classifyError(error);
  return new PosterGenerationError(phase, code);
}

function validateReference(value: unknown, postId: string): PosterReference {
  if (typeof value !== "object" || value === null) throw new PosterGenerationError("storage", "TERMINAL_FAILURE");
  const record = value as Record<string, unknown>;
  const reference = posterReferenceSchema.parse({
    id: record.id,
    postId: record.postId,
    stage: record.stage,
    mediaType: record.mediaType,
    byteSize: record.byteSize,
    completedAt: record.completedAt,
  });
  if (reference.postId !== postId) throw new PosterGenerationError("storage", "INVALID_INPUT");
  return Object.freeze(reference);
}

/**
 * Generate and persist one poster for an illustration stage. The storage
 * reference is returned only after `savePoster` has verified a completed
 * GridFS file and manifest. A crash after provider billing but before storage
 * publication can still require a retry; provider-side exactly-once billing
 * is outside this function's guarantees.
 */
export async function generatePoster(
  value: unknown,
  dependencies: PosterGenerationDependencies = {},
  env?: Environment,
): Promise<PosterReference> {
  let input: GeneratePosterInput;
  try {
    input = generatePosterInputSchema.parse(value);
  } catch {
    throw new PosterGenerationError("validation", "INVALID_INPUT");
  }

  const loadPoster = dependencies.getPoster ?? getPoster;
  if (input.existingPosterId) {
    try {
      const existing = await loadPoster(input.existingPosterId, env);
      if (existing) return validateReference(existing, input.postId);
    } catch (error) {
      throw failure("storage", error);
    }
  }

  let image: Awaited<ReturnType<typeof generateImage>>;
  try {
    const providerConfig: ImageProviderConfig = input.imageConfig;
    image = await (dependencies.generateImage ?? generateImage)(input.prompt, providerConfig);
    if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0 ||
        !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) {
      throw new AppError("TERMINAL_FAILURE");
    }
  } catch (error) {
    throw failure("provider", error);
  }

  try {
    const record = await (dependencies.savePoster ?? savePoster)({
      postId: input.postId,
      stage: "illustrate",
      mediaType: image.mimeType as "image/png" | "image/jpeg" | "image/webp",
      bytes: image.bytes,
    }, env);
    return validateReference(record, input.postId);
  } catch (error) {
    throw failure("storage", error);
  }
}

export const posterInputSchema = generatePosterInputSchema;
