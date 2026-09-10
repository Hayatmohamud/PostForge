import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getServerConfig } from "../../src/lib/config";
import {
  createGenerationRequestedEvent,
  GENERATION_REQUESTED_EVENT,
  generationRequestedEventSchema,
} from "../../src/inngest/events";
import { createInngestClient, getInngestEventEndpoint } from "../../src/inngest/client";

const postId = "507f1f77bcf86cd799439011";
const eventId = "507f1f77bcf86cd799439012";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    OPENROUTER_API_KEY: "fake-openrouter",
    OPENROUTER_MODEL: "z-ai/glm-5.3-flash",
    SERPER_API_KEY: "fake-serper",
    GEMINI_API_KEY: "fake-gemini",
    IMAGE_PROVIDER: "gemini",
    IMAGE_MODEL: "gemini-2.5-flash-image",
    MONGODB_URI: "mongodb://fake-user:fake-password@localhost:27017",
    MONGODB_DB: "postforge_test_events",
    INNGEST_DEV: "true",
    INNGEST_EVENT_KEY: "",
    INNGEST_SIGNING_KEY: "",
    ...overrides,
  };
}

describe("generation event contract", () => {
  test("creates a stable, JSON-safe event from generated identities", () => {
    const event = createGenerationRequestedEvent({ postId, eventId });
    expect(event).toEqual({ name: GENERATION_REQUESTED_EVENT, data: { postId, eventId } });
    expect(generationRequestedEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });

  test.each([
    {},
    { postId, eventId, topic: "raw user text is not part of this event" },
    { postId: "not-an-id", eventId },
    { postId, eventId: "" },
  ])("rejects malformed or overbroad payload %#", (data) => {
    expect(() => createGenerationRequestedEvent(data)).toThrow();
  });
});

describe("Inngest client", () => {
  test("uses the local dev endpoint without requiring event credentials", async () => {
    const config = getServerConfig(env());
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:8288/e/postforge-dev");
      expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
      const [payload] = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      expect(payload).toMatchObject(createGenerationRequestedEvent({ postId, eventId }));
      expect(payload.ts).toEqual(expect.any(Number));
      return new Response(JSON.stringify({ ids: [eventId], status: 200 }), { status: 200 });
    });
    const client = createInngestClient({ config, fetch: request });
    await expect(client.send(createGenerationRequestedEvent({ postId, eventId }))).resolves.toEqual({ ids: [eventId] });
  });

  test("uses the cloud endpoint and bearer key", () => {
    const config = getServerConfig(env({ INNGEST_DEV: "false", INNGEST_EVENT_KEY: "fake-event-key", INNGEST_SIGNING_KEY: "fake-signing-key" }));
    expect(getInngestEventEndpoint(config)).toBe("https://inn.gs/e/fake-event-key");
  });

  test.each([401, 403])("maps credential response %s safely", async (status) => {
    const client = createInngestClient({
      config: getServerConfig(env()),
      fetch: async () => new Response("private response", { status }),
    });
    await expect(client.send(createGenerationRequestedEvent({ postId, eventId }))).rejects.toMatchObject({ code: "CONFIGURATION_ERROR" });
  });

  test("maps a failed response without exposing its body", async () => {
    const client = createInngestClient({
      config: getServerConfig(env()),
      fetch: async () => new Response("fake credential response", { status: 503 }),
    });
    const error = await client.send(createGenerationRequestedEvent({ postId, eventId })).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "TRANSIENT_FAILURE" });
    expect(JSON.stringify(error)).not.toContain("fake credential response");
  });
});
