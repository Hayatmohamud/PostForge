import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getServerConfig } from "../../src/lib/config";
import { searchWeb } from "../../src/agents/tools/web-search";

const env = {
  OPENROUTER_API_KEY: "openrouter-secret", OPENROUTER_MODEL: "z-ai/glm-5.3-flash", SERPER_API_KEY: "serper-secret",
  GEMINI_API_KEY: "gemini-secret", IMAGE_PROVIDER: "gemini", IMAGE_MODEL: "gemini-2.5-flash-image",
  MONGODB_URI: "mongodb://user:password@localhost:27017", MONGODB_DB: "postforge_test_search", INNGEST_DEV: "true", INNGEST_EVENT_KEY: "", INNGEST_SIGNING_KEY: "",
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Serper search tool", () => {
  test("sends a bounded query and normalizes attributable results", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ organic: [{ title: " Result ", link: "https://example.com/a", snippet: " Snippet " }] }));
    await expect(searchWeb("  climate research  ", { fetch: request }, env)).resolves.toEqual([{ title: "Result", url: "https://example.com/a", snippet: "Snippet" }]);
    expect(request).toHaveBeenCalledWith("https://google.serper.dev/search", expect.objectContaining({ body: JSON.stringify({ q: "climate research", num: 10 }) }));
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "serper-secret" });
  });

  test("skips malformed results while retaining valid results", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ organic: [{ title: "valid", link: "https://example.com", snippet: "ok" }, { title: "bad", link: "javascript:alert(1)", snippet: "bad" }] }));
    await expect(searchWeb("valid query", { fetch: request }, env)).resolves.toHaveLength(1);
  });

  test("classifies an entirely malformed result payload as terminal", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ organic: [{ title: "bad", link: "javascript:alert(1)", snippet: "bad" }] }));
    await expect(searchWeb("malformed query", { fetch: request }, env)).rejects.toMatchObject({ code: "TERMINAL_FAILURE" });
  });

  test("returns an empty result set for an empty organic response", async () => {
    await expect(searchWeb("nothing", { fetch: vi.fn<typeof fetch>().mockResolvedValue(response({ organic: [] })) }, env)).resolves.toEqual([]);
  });

  test.each(["", "x".repeat(501), "bad\u0000query"])('rejects invalid query "%s" before request', async (query) => {
    const request = vi.fn<typeof fetch>();
    await expect(searchWeb(query, { fetch: request }, env)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(request).not.toHaveBeenCalled();
  });

  test.each([401, 429, 503])("classifies provider status %s safely", async (status) => {
    const error = await searchWeb("query", { fetch: vi.fn<typeof fetch>().mockResolvedValue(response({ error: "private" }, status)), config: getServerConfig(env) }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: status === 401 ? "CONFIGURATION_ERROR" : "TRANSIENT_FAILURE" });
    expect(JSON.stringify(error)).not.toContain("private");
  });
});
