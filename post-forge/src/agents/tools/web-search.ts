import "server-only";

import { z } from "zod";
import { getServerConfig, type ServerConfig } from "../../lib/config";
import { AppError } from "../../lib/errors";

const SERPER_ENDPOINT = "https://google.serper.dev/search";
const QUERY_MAX_CHARS = 500;
const RESULT_MAX_CHARS = 2_000;
const responseItemSchema = z.object({ title: z.unknown(), link: z.unknown(), snippet: z.unknown() }).passthrough();
const responseSchema = z.object({ organic: z.array(responseItemSchema).optional() }).passthrough();

type Environment = Readonly<Record<string, string | undefined>>;
type FetchLike = typeof fetch;

export type WebSearchResult = Readonly<{ title: string; url: string; snippet: string }>;
export type WebSearchDependencies = Readonly<{ fetch?: FetchLike; config?: ServerConfig }>;

function validateQuery(value: unknown): string {
  if (typeof value !== "string") throw new AppError("INVALID_INPUT");
  const query = value.trim();
  if (!query || query.length > QUERY_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(query)) throw new AppError("INVALID_INPUT");
  return query;
}

function normalizeResult(item: z.infer<typeof responseItemSchema>): WebSearchResult | null {
  if (typeof item.title !== "string" || typeof item.link !== "string" || typeof item.snippet !== "string") return null;
  const title = item.title.trim();
  const snippet = item.snippet.trim();
  let url: URL;
  try { url = new URL(item.link.trim()); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !title || !snippet) return null;
  return Object.freeze({ title: title.slice(0, RESULT_MAX_CHARS), url: url.href, snippet: snippet.slice(0, RESULT_MAX_CHARS) });
}

function errorForStatus(status: number): AppError {
  if (status === 401 || status === 403) return new AppError("CONFIGURATION_ERROR");
  if (status === 408 || status === 429 || status >= 500) return new AppError("TRANSIENT_FAILURE");
  return new AppError("TERMINAL_FAILURE");
}

export async function searchWeb(queryValue: unknown, dependencies: WebSearchDependencies = {}, env?: Environment): Promise<readonly WebSearchResult[]> {
  const query = validateQuery(queryValue);
  const config = dependencies.config ?? getServerConfig(env);
  const request = dependencies.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.limits.providerTimeoutMs);
  try {
    let response: Response;
    try {
      response = await request(SERPER_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.serperApiKey },
        body: JSON.stringify({ q: query, num: config.limits.searchMaxResults }),
        signal: controller.signal,
      });
    } catch { throw new AppError("TRANSIENT_FAILURE"); }
    if (!response.ok) throw errorForStatus(response.status);
    let payload: z.infer<typeof responseSchema>;
    try { payload = responseSchema.parse(await response.json()); } catch { throw new AppError("TERMINAL_FAILURE"); }
    const organic = payload.organic ?? [];
    const normalized = organic.map(normalizeResult).filter((item): item is WebSearchResult => item !== null).slice(0, config.limits.searchMaxResults);
    if (organic.length > 0 && normalized.length === 0) throw new AppError("TERMINAL_FAILURE");
    return Object.freeze(normalized);
  } finally {
    clearTimeout(timer);
  }
}

export const webSearch = searchWeb;
