import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { generateImage, getImageProvider } from "@/lib/image";

const config = { provider: "gemini", model: "gemini-2.5-flash-image", apiKey: "test-key", timeoutMs: 100, maxBytes: 100 };
const response = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("image provider", () => {
  test("returns image bytes from a non-first Gemini part", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ candidates: [{ content: { parts: [{ text: "done" }, { inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }] }));
    await expect(generateImage("a poster", config, { fetch: request })).resolves.toEqual({ bytes: new Uint8Array([104, 101, 108, 108, 111]), mimeType: "image/png" });
    expect(request).toHaveBeenCalledOnce();
  });

  test("classifies timeout as transient", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout"));
    await expect(generateImage("a poster", config, { fetch: request })).rejects.toMatchObject({ code: "TRANSIENT_FAILURE" });
  });

  test("rejects empty or malformed image output", async () => {
    const empty = vi.fn<typeof fetch>().mockResolvedValue(response({ candidates: [{ content: { parts: [{ text: "only text" }] } }] }));
    await expect(generateImage("a poster", config, { fetch: empty })).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(response({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "%%%" } }] } }] }));
    await expect(generateImage("a poster", config, { fetch: malformed })).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
  });

  test("rejects unsupported providers before making a request", () => {
    try {
      getImageProvider({ ...config, provider: "openai" });
      throw new Error("expected provider construction to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFIGURATION_ERROR" });
    }
  });
});
