import "server-only";

import { getServerConfig, type ServerConfig } from "../../lib/config";
import { AppError } from "../../lib/errors";
import { validatePublicUrl, type ResolveHostname } from "../../lib/public-url";

const MAX_REDIRECTS = 5;
const READABLE_TYPES = ["text/", "application/json", "application/xhtml+xml"];
type Environment = Readonly<Record<string, string | undefined>>;
type FetchLike = typeof fetch;

export type FetchedUrl = Readonly<{ url: string; content: string; contentType: string }>;
export type FetchUrlDependencies = Readonly<{ fetch?: FetchLike; resolve?: ResolveHostname; config?: ServerConfig }>;

function errorForStatus(status: number): AppError {
  if (status === 408 || status === 429 || status >= 500) return new AppError("TRANSIENT_FAILURE");
  return new AppError("TERMINAL_FAILURE");
}

function readableContentType(value: string): boolean {
  const type = value.split(";", 1)[0].trim().toLowerCase();
  return READABLE_TYPES.some((prefix) => type.startsWith(prefix));
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isSafeInteger(declared) && declared > maxBytes) throw new AppError("TERMINAL_FAILURE");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new AppError("TERMINAL_FAILURE");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new AppError("TERMINAL_FAILURE"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function htmlToText(value: string): string {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

export async function fetchPublicUrl(value: unknown, dependencies: FetchUrlDependencies = {}, env?: Environment): Promise<FetchedUrl> {
  const config = dependencies.config ?? getServerConfig(env);
  const request = dependencies.fetch ?? fetch;
  let current = await validatePublicUrl(value, dependencies.resolve);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.limits.providerTimeoutMs);
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      let response: Response;
      try {
        response = await request(current.href, { redirect: "manual", signal: controller.signal, headers: { accept: "text/html, text/plain, application/xhtml+xml, application/json" } });
      } catch { throw new AppError("TRANSIENT_FAILURE"); }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) throw new AppError("TERMINAL_FAILURE");
        let next: string;
        try { next = new URL(location, current).href; } catch { throw new AppError("INVALID_INPUT"); }
        current = await validatePublicUrl(next, dependencies.resolve);
        continue;
      }
      if (!response.ok) throw errorForStatus(response.status);
      const contentType = response.headers.get("content-type") ?? "";
      if (!readableContentType(contentType)) throw new AppError("TERMINAL_FAILURE");
      const text = new TextDecoder().decode(await readBounded(response, config.limits.sourceMaxBytes));
      const content = contentType.toLowerCase().startsWith("text/") || contentType.toLowerCase().includes("xhtml") ? htmlToText(text) : text.trim();
      if (!content) throw new AppError("TERMINAL_FAILURE");
      return Object.freeze({ url: current.href, content, contentType: contentType.split(";", 1)[0].trim().toLowerCase() });
    }
    throw new AppError("TERMINAL_FAILURE");
  } finally { clearTimeout(timer); }
}

export const fetchUrl = fetchPublicUrl;
