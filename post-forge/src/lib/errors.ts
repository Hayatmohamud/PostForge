import "server-only";

const definitions = {
  INVALID_INPUT: { message: "Check the submitted input and try again.", status: 400, retryable: false },
  CONFIGURATION_ERROR: { message: "The service is not configured correctly.", status: 500, retryable: false },
  INSUFFICIENT_EVIDENCE: { message: "There is not enough supported evidence to produce a post.", status: 422, retryable: false },
  TRANSIENT_FAILURE: { message: "A temporary service problem interrupted this operation.", status: 503, retryable: true },
  TERMINAL_FAILURE: { message: "The operation could not be completed.", status: 500, retryable: false },
} as const;

export type ErrorCode = keyof typeof definitions;
export type Stage = "research" | "verify" | "write" | "edit" | "illustrate" | "publish";
export type Correlation = Readonly<{ postId?: string; stage?: Stage }>;
export type PublicError = Readonly<{
  code: ErrorCode;
  message: string;
  status: number;
  retryable: boolean;
  postId?: string;
  stage?: Stage;
}>;

/** Read data properties only: diagnostics must never invoke arbitrary getters. */
export function readDiagnosticField(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Correlation must come from generated application IDs, never provider/user text. */
export function sanitizeCorrelation(value: unknown): Correlation {
  const postId = readDiagnosticField(value, "postId");
  const stage = readDiagnosticField(value, "stage");
  const result: { postId?: string; stage?: Stage } = {};
  // Accommodate MongoDB ObjectIds and UUID submission/run-associated post IDs.
  if (typeof postId === "string" && /^(?:[a-f0-9]{24}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(postId)) {
    result.postId = postId;
  }
  if (typeof stage === "string" && ["research", "verify", "write", "edit", "illustrate", "publish"].includes(stage)) {
    result.stage = stage as Stage;
  }
  return Object.freeze(result);
}

/** No caller-supplied public message. Causes are private diagnostics only. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, options?: ErrorOptions) {
    const safeCode = Object.hasOwn(definitions, code) ? code : "TERMINAL_FAILURE";
    super(definitions[safeCode].message, options);
    this.name = "AppError";
    this.code = safeCode;
    Object.freeze(this);
  }

  toJSON(): PublicError {
    return toPublicError(this);
  }
}

/**
 * Classify known transport signals without copying their messages or payloads.
 * Provider 4xx errors are not automatically blamed on the user's topic.
 * Callers must still enforce finite retry budgets and idempotent side effects.
 */
export function classifyError(error: unknown): ErrorCode {
  try {
    if (error instanceof AppError) {
      const code = readDiagnosticField(error, "code");
      return typeof code === "string" && Object.hasOwn(definitions, code)
        ? code as ErrorCode
        : "TERMINAL_FAILURE";
    }
    // TASK-004's ConfigurationError has a safe, own name property. Avoid
    // importing configuration or requiring credentials just to report a failure.
    if (readDiagnosticField(error, "name") === "ConfigurationError") return "CONFIGURATION_ERROR";
    const status = readDiagnosticField(error, "status") ?? readDiagnosticField(error, "statusCode");
    if (status === 401 || status === 403) return "CONFIGURATION_ERROR";
    if (status === 408 || status === 429 || (typeof status === "number" && Number.isInteger(status) && status >= 500 && status <= 599)) {
      return "TRANSIENT_FAILURE";
    }
    const code = readDiagnosticField(error, "code");
    if (typeof code === "string" && ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)) {
      return "TRANSIENT_FAILURE";
    }
    if (readDiagnosticField(error, "name") === "TimeoutError") return "TRANSIENT_FAILURE";
  } catch {
    // Revoked proxies and malformed thrown values are terminal, not loggable.
  }
  return "TERMINAL_FAILURE";
}

export function isRetryable(error: unknown): boolean {
  return definitions[classifyError(error)].retryable;
}

/**
 * Explicit projection drops all untrusted fields and their entire nested graphs,
 * including cause, stack, details, headers, responses, and provider payloads.
 * Correlation is supplied separately by the server, never taken from the error.
 */
export function toPublicError(error: unknown, correlation?: Correlation): PublicError {
  const code = classifyError(error);
  return Object.freeze({ code, ...definitions[code], ...sanitizeCorrelation(correlation) });
}
