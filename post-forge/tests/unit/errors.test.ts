import { describe, expect, test, vi } from "vitest";

// Mock only Next's compiler marker; all error and logger behavior stays real.
vi.mock("server-only", () => ({}));
import { ConfigurationError } from "../../src/lib/config";
import {
  AppError, classifyError, isRetryable, sanitizeCorrelation, toPublicError,
  type ErrorCode, type Stage,
} from "../../src/lib/errors";
import { createLogger, sanitizeLogMetadata, type LogEntry } from "../../src/lib/logging";

const postId = "507f1f77bcf86cd799439011";
const correlation = { postId, stage: "verify" as const };
const secrets = [
  "sk-fake-provider-secret", "fake-password", "fake-signing-key", "Bearer fake-access-token",
  "mongodb://fake-user:fake-password@private.invalid", "raw generated provider content",
];

function unsafeError() {
  return Object.assign(new Error(secrets.join(" "), { cause: { password: secrets[1] } }), {
    status: 429,
    details: { response: { body: secrets[5], headers: { authorization: secrets[3] } } },
    payload: { url: secrets[4], nested: [{ apiKey: secrets[0], signingKey: secrets[2] }] },
  });
}

function expectNoSecrets(value: unknown) {
  const json = JSON.stringify(value);
  for (const secret of secrets) expect(json).not.toContain(secret);
  for (const field of ["stack", "cause", "details", "payload", "authorization", "password", "apiKey"]) {
    expect(json).not.toContain(`"${field}"`);
  }
}

describe("application error classification", () => {
  test.each([
    ["INVALID_INPUT", 400, false],
    ["CONFIGURATION_ERROR", 500, false],
    ["INSUFFICIENT_EVIDENCE", 422, false],
    ["TRANSIENT_FAILURE", 503, true],
    ["TERMINAL_FAILURE", 500, false],
  ] as const)("preserves %s classification with a fixed public contract", (code, status, retryable) => {
    const error = new AppError(code, { cause: unsafeError() });
    expect(classifyError(error)).toBe(code);
    expect(isRetryable(error)).toBe(retryable);
    expect(toPublicError(error, correlation)).toEqual({ code, message: error.message, status, retryable, ...correlation });
    expect(Object.isFrozen(error)).toBe(true);
    expectNoSecrets(toPublicError(error));
    expectNoSecrets(JSON.parse(JSON.stringify(error)));
  });

  test("maps the existing configuration error without exposing its field list", () => {
    const error = new ConfigurationError(["OPENROUTER_API_KEY", secrets[0]]);
    expect(toPublicError(error)).toEqual({
      code: "CONFIGURATION_ERROR", message: "The service is not configured correctly.", status: 500, retryable: false,
    });
    expectNoSecrets(toPublicError(error));
  });

  test.each([408, 429, 500, 502, 503, 504, 599])("treats transport HTTP %s as transient", (status) => {
    expect(classifyError({ status, message: secrets[0] })).toBe("TRANSIENT_FAILURE");
    expect(isRetryable({ statusCode: status })).toBe(true);
  });

  test.each([401, 403])("maps provider authorization HTTP %s to server configuration", (status) => {
    expect(classifyError({ status })).toBe("CONFIGURATION_ERROR");
    expect(isRetryable({ status })).toBe(false);
  });

  test.each(["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"])("recognizes bounded retry candidates for %s", (code) => {
    expect(isRetryable(Object.assign(new Error(secrets[0]), { code }))).toBe(true);
  });

  test("distinguishes an explicit timeout from cancellation", () => {
    expect(isRetryable({ name: "TimeoutError" })).toBe(true);
    expect(isRetryable({ name: "AbortError" })).toBe(false);
  });

  test.each([400, 404, 409, 422, 499, 600, Infinity, NaN, 500.5, "503"])("does not retry unknown/permanent HTTP status %s", (status) => {
    expect(classifyError({ status, message: "retry this immediately" })).toBe("TERMINAL_FAILURE");
    expect(isRetryable({ status })).toBe(false);
  });

  test.each([undefined, null, "secret failure", 123, false, {}, new Error("private failure"), { code: "ENOTFOUND" }])("unknown thrown value %s is terminal", (error) => {
    expect(classifyError(error)).toBe("TERMINAL_FAILURE");
    expect(isRetryable(error)).toBe(false);
  });

  test("an explicit terminal decision overrides a retryable cause", () => {
    expect(isRetryable(new AppError("TERMINAL_FAILURE", { cause: { status: 503 } }))).toBe(false);
  });

  test("ignores spoofed retry flags and malicious messages", () => {
    expect(toPublicError({ code: "TRANSIENT_FAILURE", retryable: true, message: secrets[0] })).toEqual({
      code: "TERMINAL_FAILURE", message: "The operation could not be completed.", status: 500, retryable: false,
    });
    expect(classifyError(new AppError("unknown" as ErrorCode))).toBe("TERMINAL_FAILURE");
  });

  test("rejects forged AppError prototypes instead of trusting missing or getter codes", () => {
    const forged: object = Object.create(AppError.prototype);
    expect(classifyError(forged)).toBe("TERMINAL_FAILURE");
    expect(isRetryable(forged)).toBe(false);
    const getter = vi.fn(() => { throw new Error(secrets[0]); });
    Object.defineProperty(forged, "code", { get: getter });
    expect(toPublicError(forged).code).toBe("TERMINAL_FAILURE");
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("public diagnostics and correlation", () => {
  test("drops nested provider graphs, stack, cause, and fake secrets without mutating the source", () => {
    const error = unsafeError();
    const result = toPublicError(error, correlation);
    expect(Object.keys(result).sort()).toEqual(["code", "message", "postId", "retryable", "stage", "status"]);
    expect(result).toMatchObject({ code: "TRANSIENT_FAILURE", status: 503, retryable: true, ...correlation });
    expectNoSecrets(result);
    expect(error.message).toContain(secrets[0]);
    expect(error.payload.nested[0].apiKey).toBe(secrets[0]);
  });

  test("never takes correlation from provider errors", () => {
    expect(toPublicError({ status: 500, postId, stage: "research" })).not.toHaveProperty("postId");
  });

  test.each(["research", "verify", "write", "edit", "illustrate", "publish"] as const)("keeps generated post ID and stage %s", (stage) => {
    expect(sanitizeCorrelation({ postId, stage })).toEqual({ postId, stage });
  });

  test("accepts generated UUID correlation", () => {
    const uuid = "9a3c6bea-e098-4386-94c6-22e7a16b9942";
    expect(sanitizeCorrelation({ postId: uuid })).toEqual({ postId: uuid });
  });

  test.each([secrets[0], "../secret", `${postId}\n`, "", "a".repeat(1000)])("rejects unsafe ID %s", (id) => {
    expect(sanitizeCorrelation({ postId: id, stage: secrets[0] as Stage })).toEqual({});
  });

  test("does not execute getters, toJSON methods, or revoked proxies", () => {
    const getter = vi.fn(() => { throw new Error(secrets[0]); });
    const toJSON = vi.fn(() => ({ secret: secrets[0] }));
    const error = Object.defineProperties({ toJSON }, { status: { get: getter }, message: { get: getter } });
    expect(toPublicError(error).code).toBe("TERMINAL_FAILURE");
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();
    expect(toPublicError(proxy.proxy).code).toBe("TERMINAL_FAILURE");
    expect(sanitizeCorrelation(proxy.proxy)).toEqual({});
  });
});

describe("bounded recursive log redaction", () => {
  test("preserves useful counters and nested correlation without raw strings/keys", () => {
    const input = {
      metrics: { durationMs: 42, count: 3, password: secrets[1] },
      metadata: { context: { ...correlation, secret: secrets[0], headers: { authorization: secrets[3] } } },
      items: [{ attempt: 2, payload: secrets[5] }, secrets[0]],
      error: unsafeError(), retryable: true, status: 503,
      [secrets[2]]: secrets[4], message: secrets[5], response: { body: secrets[5] },
    };
    const result = sanitizeLogMetadata(input);
    expect(result).toMatchObject({
      metrics: { durationMs: 42, count: 3 }, metadata: { context: correlation },
      items: [{ attempt: 2 }, "[REDACTED]"], retryable: true, status: 503,
      error: { code: "TRANSIENT_FAILURE", status: 503 },
    });
    expectNoSecrets(result);
    expect(input.metrics.password).toBe(secrets[1]);
  });

  test("handles circular, deep, and large metadata with finite output", () => {
    const cycle: { metadata?: unknown } = {};
    cycle.metadata = cycle;
    expect(sanitizeLogMetadata(cycle)).toEqual({ metadata: "[REDACTED]" });
    let deep: unknown = { count: 1 };
    for (let index = 0; index < 100; index++) deep = { metadata: deep };
    expect(JSON.stringify(sanitizeLogMetadata(deep))).toContain("[REDACTED]");
    expect(JSON.stringify(sanitizeLogMetadata({ items: Array.from({ length: 10_000 }, () => ({ count: 1 })) })).length).toBeLessThan(1000);
  });

  test("never invokes accessors or custom serializers", () => {
    const getter = vi.fn(() => { throw new Error(secrets[0]); });
    const serializer = vi.fn(() => secrets[0]);
    const data = Object.defineProperties({ toJSON: serializer }, { count: { get: getter, enumerable: true } });
    expect(sanitizeLogMetadata(data)).toEqual({});
    const array = [null];
    Object.defineProperty(array, "0", { get: getter });
    expect(sanitizeLogMetadata({ items: array })).toEqual({ items: ["[REDACTED]"] });
    expect(getter).not.toHaveBeenCalled();
    expect(serializer).not.toHaveBeenCalled();
  });

  test("drops invalid counters, untrusted text, and handles unusual inputs", () => {
    expect(sanitizeLogMetadata({ count: Infinity, durationMs: -1, byteSize: 1.5, attempt: "1", retryable: "true" })).toEqual({});
    for (const input of [BigInt(1), secrets[0], Symbol("private"), () => secrets[0]]) {
      expect(sanitizeLogMetadata(input)).toBe("[REDACTED]");
    }
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();
    expect(sanitizeLogMetadata(proxy.proxy)).toBe("[REDACTED]");
  });
});

describe("structured logging", () => {
  test("emits one safe JSON record with error and post/stage correlation", () => {
    const sink = vi.fn();
    createLogger(sink)({ level: "error", event: "operation.failed", correlation, error: unsafeError(), metadata: { attempt: 2, response: secrets[5] } });
    expect(sink).toHaveBeenCalledTimes(1);
    const [line] = sink.mock.calls[0];
    const record = JSON.parse(line);
    expect(record).toMatchObject({ level: "error", event: "operation.failed", ...correlation, metadata: { attempt: 2 }, error: { code: "TRANSIENT_FAILURE", ...correlation } });
    expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);
    expect(line).not.toContain("\n");
    expectNoSecrets(record);
  });

  test("can emit successful operation events without inventing an error", () => {
    const sink = vi.fn();
    createLogger(sink)({ level: "info", event: "operation.completed", correlation, metadata: { durationMs: 8 } });
    expect(JSON.parse(sink.mock.calls[0][0])).not.toHaveProperty("error");
  });

  test("normalizes malicious event/level values and ignores arbitrary entry fields", () => {
    const sink = vi.fn();
    const entry = { level: secrets[0], event: `error\n${secrets[1]}`, payload: secrets[5], message: secrets[4] } as unknown as LogEntry;
    createLogger(sink)(entry);
    expect(JSON.parse(sink.mock.calls[0][0])).toMatchObject({ level: "error", event: "operation.failed" });
    expectNoSecrets(JSON.parse(sink.mock.calls[0][0]));
  });

  test("does not invoke entry getters", () => {
    const sink = vi.fn();
    const getter = vi.fn(() => { throw new Error(secrets[0]); });
    const entry = Object.defineProperty({ level: "info", event: "operation.started" }, "metadata", { get: getter });
    expect(() => createLogger(sink)(entry as LogEntry)).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expectNoSecrets(JSON.parse(sink.mock.calls[0][0]));
  });

  test("a broken sink or malformed input never replaces the original outcome", () => {
    const sink = vi.fn(() => { throw new Error(secrets[0]); });
    const log = createLogger(sink);
    expect(() => log({ level: "error", event: "operation.failed", error: unsafeError() })).not.toThrow();
    expect(() => log(null as unknown as LogEntry)).not.toThrow();
    const proxy = Proxy.revocable({}, {});
    proxy.revoke();
    expect(() => log(proxy.proxy as LogEntry)).not.toThrow();
  });
});
