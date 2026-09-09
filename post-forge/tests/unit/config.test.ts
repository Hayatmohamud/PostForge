import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { afterEach, describe, expect, test, vi } from "vitest";

// Next resolves this marker itself; a Node unit worker has no React server
// condition. Mock only the marker, never the configuration implementation.
vi.mock("server-only", () => ({}));
import { ConfigurationError, getServerConfig } from "../../src/lib/config";

function validEnv(): Record<string, string | undefined> {
  return {
    OPENROUTER_API_KEY: "fake-openrouter-secret",
    OPENROUTER_MODEL: "z-ai/glm-5.3-flash",
    SERPER_API_KEY: "fake-serper-secret",
    GEMINI_API_KEY: "fake-gemini-secret",
    IMAGE_PROVIDER: "gemini",
    IMAGE_MODEL: "gemini-2.5-flash-image",
    MONGODB_URI: "mongodb://fake-user:fake-password@localhost:27017",
    MONGODB_DB: "postforge_test_config",
    INNGEST_EVENT_KEY: "fake-event-secret",
    INNGEST_SIGNING_KEY: "fake-signing-secret",
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("server environment", () => {
  test("accepts explicit values, trims whitespace, and preserves selected models", () => {
    const env = validEnv();
    env.OPENROUTER_MODEL = "  another-compatible/model  ";
    const config = getServerConfig(env);
    expect(config.openrouter).toEqual({ apiKey: env.OPENROUTER_API_KEY, model: "another-compatible/model" });
    expect(config.image).toEqual({ provider: "gemini", model: env.IMAGE_MODEL, apiKey: env.GEMINI_API_KEY });
    expect(config.mongodb).toEqual({ uri: env.MONGODB_URI, db: env.MONGODB_DB });
    expect(config.inngest).toEqual({ isDev: false, eventKey: env.INNGEST_EVENT_KEY, signingKey: env.INNGEST_SIGNING_KEY });
    expect(config.serperApiKey).toBe(env.SERPER_API_KEY);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.limits)).toBe(true);
  });

  test.each(Object.keys(validEnv()))("rejects missing and blank %s", (name) => {
    for (const value of [undefined, "", " \t\n"]) {
      expect(() => getServerConfig({ ...validEnv(), [name]: value })).toThrow(name);
    }
  });

  test.each(["openai", "Gemini", "fake-unsupported-secret"])("rejects unsupported image provider %s", (provider) => {
    expect(() => getServerConfig({ ...validEnv(), IMAGE_PROVIDER: provider })).toThrow("IMAGE_PROVIDER");
  });

  test.each(["true", "1"])("permits keyless local Inngest only with explicit %s", (mode) => {
    const config = getServerConfig({ ...validEnv(), INNGEST_DEV: mode, INNGEST_EVENT_KEY: "", INNGEST_SIGNING_KEY: undefined });
    expect(config.inngest).toEqual({ isDev: true, eventKey: undefined, signingKey: undefined });
  });

  test.each([undefined, "false", "0"])("requires cloud keys for mode %s regardless of NODE_ENV", (mode) => {
    expect(() => getServerConfig({ ...validEnv(), NODE_ENV: "development", INNGEST_DEV: mode, INNGEST_EVENT_KEY: "", INNGEST_SIGNING_KEY: "" })).toThrow("INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY");
  });

  test.each(["", " ", "yes", "TRUE", "https://fake-secret.example"])("rejects ambiguous Inngest mode %s", (mode) => {
    expect(() => getServerConfig({ ...validEnv(), INNGEST_DEV: mode })).toThrow("INNGEST_DEV");
  });

  test("reads process.env lazily and validates on every server entry call", () => {
    for (const [key, value] of Object.entries(validEnv())) vi.stubEnv(key, value);
    for (const [name] of bounds) vi.stubEnv(name, undefined);
    vi.stubEnv("INNGEST_DEV", "false");
    expect(getServerConfig().openrouter.model).toBe("z-ai/glm-5.3-flash");
    vi.stubEnv("OPENROUTER_MODEL", " ");
    expect(() => getServerConfig()).toThrow("OPENROUTER_MODEL");
  });

  test("errors and logs contain field names without supplied values or causes", () => {
    const env = { ...validEnv(), IMAGE_PROVIDER: "fake-provider-secret", INNGEST_DEV: "fake-mode-secret", PROVIDER_TIMEOUT_MS: "fake-timeout-secret", OPENROUTER_MODEL: "" };
    const errorLog = vi.spyOn(console, "error");
    const warnLog = vi.spyOn(console, "warn");
    const infoLog = vi.spyOn(console, "log");
    let error: unknown;
    try { getServerConfig(env); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ConfigurationError);
    const diagnostics = `${String(error)} ${JSON.stringify(error)} ${inspect(error)}`;
    expect(diagnostics).toContain("IMAGE_PROVIDER");
    expect(diagnostics).toContain("OPENROUTER_MODEL");
    for (const value of Object.values(env)) {
      if (value && value.length > 8) expect(diagnostics).not.toContain(value);
    }
    for (const fragment of ["fake-password", "fake-user", "fake-provider-secret", "fake-timeout-secret"]) {
      expect(diagnostics).not.toContain(fragment);
    }
    expect(error).not.toHaveProperty("cause");
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
    expect(infoLog).not.toHaveBeenCalled();
  });

  test("development example has verified models and empty credentials", () => {
    const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    const env = Object.fromEntries(example.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }));
    expect(env.OPENROUTER_MODEL).toBe("z-ai/glm-5.3-flash");
    expect(env.IMAGE_MODEL).toBe("gemini-2.5-flash-image");
    expect(Object.keys(env).some((name) => name.startsWith("NEXT_PUBLIC_"))).toBe(false);
    for (const key of ["OPENROUTER_API_KEY", "SERPER_API_KEY", "GEMINI_API_KEY", "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]) expect(env[key]).toBe("");
    expect(() => getServerConfig(env)).toThrow("OPENROUTER_API_KEY");
    expect(getServerConfig({ ...env, OPENROUTER_API_KEY: "fake-openrouter", SERPER_API_KEY: "fake-serper", GEMINI_API_KEY: "fake-gemini" }).inngest.isDev).toBe(true);
  });
});

const bounds = [
  ["TOPIC_MAX_CHARS", "topicMaxChars", 1, 2_000, 500],
  ["ARTICLE_MAX_CHARS", "articleMaxChars", 1, 200_000, 50_000],
  ["SEARCH_MAX_RESULTS", "searchMaxResults", 1, 20, 10],
  ["FINDINGS_MAX_COUNT", "findingsMaxCount", 1, 100, 50],
  ["SOURCE_MAX_BYTES", "sourceMaxBytes", 1, 5_242_880, 1_048_576],
  ["POSTER_MAX_BYTES", "posterMaxBytes", 1, 20_971_520, 10_485_760],
  ["PROVIDER_TIMEOUT_MS", "providerTimeoutMs", 1_000, 120_000, 30_000],
  ["IMAGE_TIMEOUT_MS", "imageTimeoutMs", 1_000, 300_000, 120_000],
  ["DATABASE_TIMEOUT_MS", "databaseTimeoutMs", 1_000, 60_000, 10_000],
  ["STAGE_CORRECTION_ATTEMPTS", "stageCorrectionAttempts", 0, 3, 2],
  ["PROVIDER_RETRIES", "providerRetries", 0, 3, 2],
  ["NETWORK_MAX_ITERATIONS", "networkMaxIterations", 6, 60, 36],
] as const;

describe("finite operational limits", () => {
  test.each(bounds)("enforces %s defaults and inclusive boundaries", (name, key, min, max, fallback) => {
    expect(getServerConfig(validEnv()).limits[key]).toBe(fallback);
    for (const value of [min, max]) expect(getServerConfig({ ...validEnv(), [name]: String(value) }).limits[key]).toBe(value);
    for (const value of [min - 1, max + 1]) expect(() => getServerConfig({ ...validEnv(), [name]: String(value) })).toThrow(name);
  });

  test.each(["", " ", "NaN", "Infinity", "1.5", "1e3", "0x1000", "-1", "9007199254740993", "1000ms"])("rejects malformed numeric limit %s", (value) => {
    expect(() => getServerConfig({ ...validEnv(), PROVIDER_TIMEOUT_MS: value })).toThrow("PROVIDER_TIMEOUT_MS");
  });
});
