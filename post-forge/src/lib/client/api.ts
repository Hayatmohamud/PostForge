import {
  errorResponseSchema,
  generateRequestSchema,
  generateResponseSchema,
  type GenerateResponse,
} from "../contracts/api";

export const PENDING_SUBMISSION_STORAGE_KEY = "postforge.pending-submission.v1";

export type PendingSubmission = Readonly<{
  topic: string;
  submissionKey: string;
}>;

export class GenerationApiError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly code?: string;

  constructor(message: string, options: { retryable: boolean; status?: number; code?: string }) {
    super(message);
    this.name = "GenerationApiError";
    this.retryable = options.retryable;
    this.status = options.status;
    this.code = options.code;
  }
}

export function createSubmissionKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `submission-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return `submission-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function readPendingSubmission(storage?: Storage): PendingSubmission | null {
  const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!target) return null;
  try {
    const raw = target.getItem(PENDING_SUBMISSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const result = generateRequestSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function writePendingSubmission(value: PendingSubmission, storage?: Storage): void {
  const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!target) return;
  try {
    target.setItem(PENDING_SUBMISSION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Submission still carries the key in memory when storage is unavailable.
  }
}

export function clearPendingSubmission(storage?: Storage): void {
  const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!target) return;
  try {
    target.removeItem(PENDING_SUBMISSION_STORAGE_KEY);
  } catch {
    // A successful submission does not need to fail because cleanup was blocked.
  }
}

function errorFromPayload(payload: unknown, status: number): GenerationApiError {
  const parsed = errorResponseSchema.safeParse(payload);
  if (parsed.success) {
    return new GenerationApiError(parsed.data.error.message, {
      code: parsed.data.error.code,
      retryable: parsed.data.error.retryable,
      status: status || parsed.data.error.status,
    });
  }
  return new GenerationApiError("We could not start this post. Try again.", {
    retryable: status >= 500 || status === 408 || status === 429,
    status: status || undefined,
  });
}

export async function submitGeneration(
  value: PendingSubmission,
  fetcher: typeof fetch = fetch,
): Promise<GenerateResponse> {
  let response: Response;
  try {
    response = await fetcher("/api/generate", {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  } catch {
    throw new GenerationApiError("We could not reach PostForge. Try again.", { retryable: true });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GenerationApiError("The generation response was invalid. Try again.", {
      retryable: response.status >= 500,
      status: response.status || undefined,
    });
  }

  if (!response.ok) throw errorFromPayload(payload, response.status);

  const parsed = generateResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GenerationApiError("The generation response was invalid. Try again.", {
      retryable: true,
      status: response.status || undefined,
    });
  }
  return parsed.data;
}
