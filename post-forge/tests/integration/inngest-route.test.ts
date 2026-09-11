import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const configuration = {
  OPENROUTER_API_KEY: "fake-openrouter",
  OPENROUTER_MODEL: "model",
  SERPER_API_KEY: "fake-serper",
  GEMINI_API_KEY: "fake-gemini",
  IMAGE_PROVIDER: "gemini",
  IMAGE_MODEL: "image-model",
  MONGODB_URI: "mongodb://fake-user:fake-password@localhost:27017",
  MONGODB_DB: "postforge_test_workflow",
  INNGEST_DEV: "true",
};

const originalEnvironment = new Map<string, string | undefined>();

function setTestEnvironment(): void {
  for (const [key, value] of Object.entries(configuration)) {
    originalEnvironment.set(key, process.env[key]);
    process.env[key] = value;
  }
}

function restoreEnvironment(): void {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnvironment.clear();
}

afterEach(() => {
  restoreEnvironment();
  vi.resetModules();
});

describe("Inngest route registration", () => {
  test("serves one generation function and its failure handler through the local runner endpoint", async () => {
    setTestEnvironment();
    const route = await import("../../src/app/api/inngest/route");

    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.GET).toBeTypeOf("function");
    expect(route.POST).toBeTypeOf("function");
    expect(route.PUT).toBeTypeOf("function");

    const response = await route.GET(new Request("http://localhost/api/inngest") as never, undefined);
    expect(response.status).toBe(200);
    const body = await response.json() as { function_count: number; mode: string; has_signing_key: boolean };
    // Inngest expands the function's onFailure hook into one companion
    // registration; no additional generation or duplicate failure handler is served.
    expect(body.function_count).toBe(2);
    expect(body.mode).toBe("dev");
    expect(body.has_signing_key).toBe(false);
  });
});
