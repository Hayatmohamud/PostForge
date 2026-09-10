import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getServerConfig } from "../../src/lib/config";
import { fetchPublicUrl } from "../../src/agents/tools/fetch-url";
import { isPrivateAddress, parsePublicUrl, validatePublicUrl } from "../../src/lib/public-url";

const env = {
  OPENROUTER_API_KEY: "openrouter-secret", OPENROUTER_MODEL: "z-ai/glm-5.3-flash", SERPER_API_KEY: "serper-secret",
  GEMINI_API_KEY: "gemini-secret", IMAGE_PROVIDER: "gemini", IMAGE_MODEL: "gemini-2.5-flash-image",
  MONGODB_URI: "mongodb://user:password@localhost:27017", MONGODB_DB: "postforge_test_fetch", INNGEST_DEV: "true", INNGEST_EVENT_KEY: "", INNGEST_SIGNING_KEY: "",
};
const response = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });

describe("public URL validation", () => {
  test.each(["http://127.0.0.1", "http://10.0.0.1", "http://[::1]", "http://localhost", "file:///tmp/x"])('rejects private or unsupported target %s', (url) => {
    expect(() => parsePublicUrl(url)).toThrow();
  });

  test("rejects DNS resolution toward a private address", async () => {
    await expect(validatePublicUrl("https://example.com", async () => ["93.184.216.34", "192.168.1.2"])).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test.each([["10.0.0.1", true], ["169.254.1.1", true], ["8.8.8.8", false], ["::1", true], ["2001:4860:4860::8888", false]] as const)("classifies address %s", (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});

describe("bounded public URL fetch", () => {
  test("extracts readable text and records the actual source URL", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response("<html><script>ignore</script><h1>Title</h1><p>Readable evidence.</p></html>"));
    await expect(fetchPublicUrl("https://example.com/article", { fetch: request, resolve: async () => ["93.184.216.34"] }, env)).resolves.toEqual({ url: "https://example.com/article", content: "Title Readable evidence.", contentType: "text/html" });
  });

  test("validates every redirect target and follows public redirects", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://example.com/next" } })).mockResolvedValueOnce(response("final text", { headers: { "content-type": "text/plain" } }));
    const resolve = vi.fn(async () => ["93.184.216.34"]);
    await expect(fetchPublicUrl("https://example.com/start", { fetch: request, resolve }, env)).resolves.toMatchObject({ url: "https://example.com/next", content: "final text" });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  test("rejects a redirect to a private address before fetching it", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    await expect(fetchPublicUrl("https://example.com/start", { fetch: request, resolve: async () => ["93.184.216.34"] }, env)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(request).toHaveBeenCalledOnce();
  });

  test.each(["image/png", "application/octet-stream"])("rejects non-readable content %s", async (contentType) => {
    await expect(fetchPublicUrl("https://example.com/file", { fetch: vi.fn<typeof fetch>().mockResolvedValue(response("bytes", { headers: { "content-type": contentType } })), resolve: async () => ["93.184.216.34"], config: getServerConfig(env) })).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
  });

  test("rejects oversized content without returning it", async () => {
    const config = getServerConfig({ ...env, SOURCE_MAX_BYTES: "4" });
    await expect(fetchPublicUrl("https://example.com/large", { fetch: vi.fn<typeof fetch>().mockResolvedValue(response("12345")), resolve: async () => ["93.184.216.34"], config })).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
  });
});
