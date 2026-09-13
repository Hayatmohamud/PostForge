import { createServer } from "node:http";
import type { PostDetailDto, PostListItem } from "../../src/lib/contracts/api";

/**
 * Stable responses used by the happy path. The values mirror the contracts
 * returned by the Serper, OpenRouter, and Gemini adapters while keeping the
 * browser test independent of credentials and provider availability.
 */
export const generationProviderFixtures = Object.freeze({
  search: Object.freeze({
    organic: Object.freeze([
      Object.freeze({
        title: "Community energy report",
        link: "https://example.com/community-energy",
        snippet: "Community solar projects can widen access to local energy.",
      }),
    ]),
  }),
  source: Object.freeze({
    title: "Community energy report",
    url: "https://example.com/community-energy",
    fetchedEvidence: "Community solar projects can widen access to local energy.",
  }),
  verify: Object.freeze({
    findings: Object.freeze([
      Object.freeze({
        findingId: "finding_1",
        verdict: "supported" as const,
        rationale: "The retrieved report directly supports the claim.",
        corroboratingSourceIds: Object.freeze([]),
      }),
    ]),
  }),
  write: Object.freeze({
    title: "How community solar widens local energy access",
    body: Object.freeze([
      Object.freeze({
        type: "paragraph" as const,
        text: "Community solar projects can widen access to local energy.",
        findingIds: Object.freeze(["finding_1"]),
        sourceIds: Object.freeze(["source_1"]),
      }),
    ]),
  }),
  edit: Object.freeze({
    title: "How community solar widens local energy access",
    body: Object.freeze([
      Object.freeze({
        type: "paragraph" as const,
        text: "Community solar projects can widen access to local energy.",
        findingIds: Object.freeze(["finding_1"]),
        sourceIds: Object.freeze(["source_1"]),
      }),
    ]),
  }),
  image: Object.freeze({
    mediaType: "image/png" as const,
    /** A tiny valid PNG keeps the poster assertion deterministic and fast. */
    bytes: Object.freeze(Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ))),
  }),
});

export const fixturePostId = "507f1f77bcf86cd799439044";
export const fixturePosterId = "507f1f77bcf86cd799439045";
export const fixtureTopic = "How community solar widens local energy access";
export const fixtureSource = Object.freeze({
  sourceId: "source_1",
  title: generationProviderFixtures.source.title,
  url: generationProviderFixtures.source.url,
});

const startedAt = "2026-09-12T08:00:00.000Z";
const endedAt = "2026-09-12T08:00:04.000Z";

export const completedStages = Object.freeze({
  research: { status: "done" as const, attempts: 1, startedAt, endedAt, activity: "Retrieved a fixture source." },
  verify: { status: "done" as const, attempts: 1, startedAt, endedAt, activity: "Verified the source-linked claim." },
  write: { status: "done" as const, attempts: 1, startedAt, endedAt, activity: "Drafted an evidence-linked article." },
  edit: { status: "done" as const, attempts: 1, startedAt, endedAt, activity: "Edited the grounded draft." },
  illustrate: { status: "done" as const, attempts: 1, startedAt, endedAt, activity: "Stored a generated poster." },
  publish: { status: "done" as const, attempts: 1, startedAt, endedAt, activity: "Saved the final post." },
});

export const queuedStages = Object.freeze({
  research: { status: "queued" as const, attempts: 0 },
  verify: { status: "queued" as const, attempts: 0 },
  write: { status: "queued" as const, attempts: 0 },
  edit: { status: "queued" as const, attempts: 0 },
  illustrate: { status: "queued" as const, attempts: 0 },
  publish: { status: "queued" as const, attempts: 0 },
});

export const completedPost: PostDetailDto = {
  postId: fixturePostId,
  topic: fixtureTopic,
  status: "done",
  stages: completedStages,
  article: {
    title: generationProviderFixtures.edit.title,
    body: generationProviderFixtures.edit.body.map((block) => ({
      ...block,
      findingIds: [...block.findingIds],
      sourceIds: [...block.sourceIds],
    })),
    citedSources: [fixtureSource],
  },
  evidence: {
    findings: [{
      findingId: "finding_1",
      claim: "Community solar projects can widen access to local energy.",
      sourceId: fixtureSource.sourceId,
      verdict: "supported",
      rationale: "The retrieved report directly supports the claim.",
    }],
    sources: [fixtureSource],
  },
  poster: {
    posterId: fixturePosterId,
    mediaType: generationProviderFixtures.image.mediaType,
    byteSize: generationProviderFixtures.image.bytes.length,
    completedAt: endedAt,
  },
  createdAt: startedAt,
  updatedAt: endedAt,
};

export const queuedPost: PostDetailDto = {
  postId: fixturePostId,
  topic: fixtureTopic,
  status: "queued",
  stages: queuedStages,
  createdAt: startedAt,
  updatedAt: startedAt,
};

export const completedLibraryItem: PostListItem = {
  postId: fixturePostId,
  topic: fixtureTopic,
  status: "done",
  posterId: fixturePosterId,
  createdAt: startedAt,
  updatedAt: endedAt,
};

export const fixturePosterBytes = Buffer.from(generationProviderFixtures.image.bytes);

type ProviderRequest = RequestInfo | URL;
type ProviderResponse = Readonly<{ body: unknown; status?: number; headers?: Record<string, string> }>;

const fixtureFinding = Object.freeze({
  findingId: "finding_1",
  claim: generationProviderFixtures.source.fetchedEvidence,
  sourceId: fixtureSource.sourceId,
  evidence: generationProviderFixtures.source.fetchedEvidence,
  corroboratingSourceIds: [],
});

function jsonResponse({ body, status = 200, headers = {} }: ProviderResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function openRouterToolCall(name: string, input: Record<string, unknown>, id: string): Response {
  return jsonResponse({
    body: {
      id: `fixture-${id}`,
      object: "chat.completion",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(input) } }],
        },
        finish_reason: "tool_calls",
      }],
    },
  });
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function openRouterFixture(body: unknown): Response {
  const payload = body as { messages?: unknown[] };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const system = messageText(messages.find((message) => (message as { role?: unknown })?.role === "system"));

  if (system.includes("research agent")) {
    if (messages.length <= 2) return openRouterToolCall("search_sources", { query: fixtureTopic }, "fixture-search");
    const last = messages.at(-1) as { tool_calls?: Array<{ function?: { name?: unknown } }> } | undefined;
    if (last?.tool_calls?.[0]?.function?.name === "search_sources") {
      return openRouterToolCall("fetch_source", { sourceId: fixtureSource.sourceId }, "fixture-fetch");
    }
    return jsonResponse({
      body: {
        id: "fixture-research",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ findings: [fixtureFinding] }) }, finish_reason: "stop" }],
      },
    });
  }

  if (system.includes("verification agent")) {
    return jsonResponse({
      body: {
        id: "fixture-verify",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ findings: [{ findingId: fixtureFinding.findingId, verdict: "supported", rationale: generationProviderFixtures.verify.findings[0].rationale, corroboratingSourceIds: [] }] }) }, finish_reason: "stop" }],
      },
    });
  }

  if (system.includes("writer agent") || system.includes("editor agent")) {
    return jsonResponse({
      body: {
        id: system.includes("writer agent") ? "fixture-write" : "fixture-edit",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ title: generationProviderFixtures.write.title, body: [{ type: "paragraph", text: fixtureFinding.claim, findingIds: [fixtureFinding.findingId], sourceIds: [fixtureSource.sourceId] }] }) }, finish_reason: "stop" }],
      },
    });
  }

  return jsonResponse({ body: { error: { message: "Unexpected fixture model request" } }, status: 500 });
}

/** AgentKit's step.ai inference runs in the Inngest dev runner, so expose the
 * same deterministic response boundary over HTTP for that process. */
function startProviderFixtureServer(): void {
  const port = Number(process.env.POSTFORGE_PROVIDER_FIXTURE_PORT ?? "8787");
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { response.writeHead(400).end(); return; }
      const result = openRouterFixture(body);
      response.statusCode = result.status ?? 200;
      for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value);
      response.end(await result.text());
    });
  });
  server.listen(port, "127.0.0.1");
}

/**
 * Install deterministic responses at the outbound provider boundary. The
 * fixture is loaded with NODE_OPTIONS for the real Next.js server process.
 * Internal application requests are never intercepted.
 */
export function installProviderFixtures(): void {
  const currentFetch = globalThis.fetch;
  globalThis.fetch = async (input: ProviderRequest, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === "https://google.serper.dev/search") {
      return jsonResponse({ body: generationProviderFixtures.search });
    }
    if (url === generationProviderFixtures.source.url) {
      return new Response(`<article><h1>${generationProviderFixtures.source.title}</h1><p>${generationProviderFixtures.source.fetchedEvidence}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      let body: unknown;
      try { body = JSON.parse(typeof init?.body === "string" ? init.body : "{}"); } catch { return jsonResponse({ body: { error: { message: "Malformed fixture request" } }, status: 400 }); }
      return openRouterFixture(body);
    }
    if (url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/")) {
      return jsonResponse({ body: { candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(fixturePosterBytes).toString("base64"), mimeType: generationProviderFixtures.image.mediaType } }] } }] } });
    }
    return currentFetch(input, init);
  };
}

if (process.env.POSTFORGE_PROVIDER_FIXTURES === "1") {
  installProviderFixtures();
  if (process.env.POSTFORGE_PROVIDER_FIXTURE_SERVER === "1") startProviderFixtureServer();
}
