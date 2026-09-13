import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createTextModel, OPENROUTER_BASE_URL } from "../../src/lib/models";
import { getServerConfig } from "../../src/lib/config";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    OPENROUTER_API_KEY: "openrouter-secret",
    OPENROUTER_MODEL: "z-ai/glm-5.3-flash",
    SERPER_API_KEY: "serper-secret",
    GEMINI_API_KEY: "gemini-secret",
    IMAGE_PROVIDER: "gemini",
    IMAGE_MODEL: "gemini-2.5-flash-image",
    MONGODB_URI: "mongodb://user:password@localhost:27017",
    MONGODB_DB: "postforge_test_models",
    INNGEST_DEV: "true",
    INNGEST_EVENT_KEY: "",
    INNGEST_SIGNING_KEY: "",
    ...overrides,
  };
}

describe("OpenRouter model factory", () => {
  test("uses the validated configured model and OpenRouter endpoint", () => {
    const model = createTextModel(undefined, { env: env() });
    expect(model.options).toMatchObject({ model: "z-ai/glm-5.3-flash", apiKey: "openrouter-secret", baseUrl: OPENROUTER_BASE_URL });
  });

  test("uses the saved model selection when resuming a run", () => {
    const model = createTextModel({ provider: "openrouter", model: "another/provider-model" }, { env: env({ OPENROUTER_MODEL: "changed/model" }) });
    expect(model.options).toMatchObject({ model: "another/provider-model", apiKey: "openrouter-secret" });
  });

  test("limits the fixture endpoint override to loopback in explicit fixture mode", () => {
    const fixture = createTextModel(undefined, { env: env({ POSTFORGE_PROVIDER_FIXTURES: "1", OPENROUTER_BASE_URL: "http://127.0.0.1:8787/v1" }) });
    expect(fixture.options).toMatchObject({ baseUrl: "http://127.0.0.1:8787/v1" });
    expect(() => createTextModel(undefined, { env: env({ POSTFORGE_PROVIDER_FIXTURES: "1", OPENROUTER_BASE_URL: "https://attacker.example/v1" }) })).toThrow();
    expect(createTextModel(undefined, { env: env({ OPENROUTER_BASE_URL: "https://attacker.example/v1" }) }).options).toMatchObject({ baseUrl: OPENROUTER_BASE_URL });
  });

  test.each([
    { provider: "other", model: "valid/model" },
    { provider: "openrouter", model: "not a valid model" },
  ])("rejects an invalid saved selection %#", (selection) => {
    expect(() => createTextModel(selection as never, { config: getServerConfig(env()) })).toThrow();
  });

  test("passes the explicit credential to the adapter", () => {
    const model = createTextModel(undefined, { env: env() });
    expect(JSON.stringify(model.options)).toContain("openrouter-secret");
    expect(model.format).toBe("openai-chat");
  });
});
