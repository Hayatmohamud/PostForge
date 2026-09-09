import "server-only";
import { sanitizeCorrelation, toPublicError, type Correlation } from "./errors";

export type LogEvent = "operation.started" | "operation.completed" | "operation.failed" | "operation.retrying" | "request.rejected";
export type LogLevel = "info" | "warn" | "error";
export type LogEntry = Readonly<{
  level: LogLevel;
  event: LogEvent;
  correlation?: Correlation;
  error?: unknown;
  metadata?: unknown;
}>;
export type LogSink = (jsonLine: string) => void;

type DiagnosticValue = null | boolean | number | string | DiagnosticValue[] | { [key: string]: DiagnosticValue };
const redacted = "[REDACTED]";
const numericFields = new Set(["attempt", "maxAttempts", "durationMs", "retryAfterMs", "count", "byteSize", "status"]);
const containers = new Set(["metrics", "metadata", "context", "items"]);

/**
 * Recursive allowlist, not a secret-pattern blacklist: even innocuous field names
 * can contain credentials or generated text. Arbitrary strings/keys are discarded.
 * Only documented counters, booleans, correlation and sanitized errors survive.
 * Limits bound diagnostic traversal; they are not application execution budgets.
 */
export function sanitizeLogMetadata(input: unknown): DiagnosticValue {
  const seen = new WeakSet<object>();
  let remaining = 100;
  function visit(value: unknown, depth: number): DiagnosticValue {
    if (--remaining < 0 || depth > 4) return redacted;
    if (value === null) return null;
    if (typeof value !== "object") return redacted;
    try {
      if (value instanceof Error) return { ...toPublicError(value) };
      if (seen.has(value)) return redacted;
      seen.add(value);
      if (Array.isArray(value)) {
        // Do not use array iteration hooks or invoke indexed accessors.
        const output: DiagnosticValue[] = [];
        const length = Math.min(value.length, 20);
        for (let index = 0; index < length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          output.push(descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1) : redacted);
        }
        return output;
      }
      const output: Record<string, DiagnosticValue> = {};
      for (const key of Object.keys(value).slice(0, 20)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) continue;
        const field: unknown = descriptor.value;
        if (numericFields.has(key) && typeof field === "number" && Number.isSafeInteger(field) && field >= 0) {
          output[key] = field;
        } else if (key === "retryable" && typeof field === "boolean") {
          output[key] = field;
        } else if (key === "postId" || key === "stage") {
          Object.assign(output, sanitizeCorrelation({ [key]: field }));
        } else if (key === "error") {
          output[key] = { ...toPublicError(field) };
        } else if (containers.has(key)) {
          output[key] = visit(field, depth + 1);
        }
        // Unknown keys, including all credential/payload fields, are omitted.
      }
      return output;
    } catch {
      return redacted;
    }
  }
  return visit(input, 0);
}

/**
 * Inject a synchronous sink for tests/adapters. Logging never propagates input,
 * serialization, or sink exceptions and never falls back to dumping raw data.
 * Supply only application-generated correlation IDs, not remote payload IDs.
 */
export function createLogger(sink: LogSink = (line) => console.log(line)) {
  return function log(entry: LogEntry): void {
    try {
      // Reuse the safe own-data-property reader semantics for hostile inputs.
      const descriptors = Object.getOwnPropertyDescriptors(entry);
      const field = (name: string): unknown => {
        const descriptor = descriptors[name];
        return descriptor && "value" in descriptor ? descriptor.value : undefined;
      };
      const level = field("level");
      const event = field("event");
      const correlation = sanitizeCorrelation(field("correlation"));
      const record = {
        timestamp: new Date().toISOString(),
        level: typeof level === "string" && ["info", "warn", "error"].includes(level) ? level : "error",
        event: typeof event === "string" && ["operation.started", "operation.completed", "operation.failed", "operation.retrying", "request.rejected"].includes(event) ? event : "operation.failed",
        ...correlation,
        ...(Object.hasOwn(descriptors, "error") ? { error: toPublicError(field("error"), correlation) } : {}),
        ...(Object.hasOwn(descriptors, "metadata") ? { metadata: sanitizeLogMetadata(field("metadata")) } : {}),
      };
      sink(JSON.stringify(record));
    } catch {
      // A broken log sink must not replace the application's original outcome.
    }
  };
}
