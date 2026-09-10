import { z } from "zod";
import { generatedIdSchema } from "../lib/contracts/evidence";

/** Stable event name shared by submission, workflow, and recovery tasks. */
export const GENERATION_REQUESTED_EVENT = "post/generate.requested" as const;

export const generationRequestedDataSchema = z.object({
  postId: generatedIdSchema,
  eventId: generatedIdSchema,
}).strict();

export const generationRequestedEventSchema = z.object({
  name: z.literal(GENERATION_REQUESTED_EVENT),
  data: generationRequestedDataSchema,
}).strict();

export type GenerationRequestedData = z.infer<typeof generationRequestedDataSchema>;
export type GenerationRequestedEvent = z.infer<typeof generationRequestedEventSchema>;

/** Build a JSON-safe event from persisted generated identities only. */
export function createGenerationRequestedEvent(value: unknown): GenerationRequestedEvent {
  return generationRequestedEventSchema.parse({
    name: GENERATION_REQUESTED_EVENT,
    data: value,
  });
}
