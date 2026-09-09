import "server-only";

import { AppError } from "../errors";
import type { ImageProvider, ImageProviderConfig, ImageResult } from "../image";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MAX_BYTES = 10_485_760;
const DEFAULT_TIMEOUT_MS = 120_000;

type GeminiPart = Readonly<{
  inlineData?: Readonly<{ data?: unknown; mimeType?: unknown }>;
  inline_data?: Readonly<{ data?: unknown; mime_type?: unknown }>;
}>;

type GeminiResponse = Readonly<{
  candidates?: ReadonlyArray<Readonly<{ content?: Readonly<{ parts?: ReadonlyArray<GeminiPart> }> }>>;
}>;

function errorForStatus(status: number): AppError {
  if (status === 401 || status === 403) return new AppError("CONFIGURATION_ERROR");
  if (status === 408 || status === 429 || status >= 500) return new AppError("TRANSIENT_FAILURE");
  return new AppError("TERMINAL_FAILURE");
}

function decodeImage(data: unknown, mimeType: unknown, maxBytes: number): ImageResult {
  if (typeof data !== "string" || typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
    throw new AppError("TERMINAL_FAILURE");
  }
  const encoded = data.trim();
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new AppError("TERMINAL_FAILURE");
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  } catch {
    throw new AppError("TERMINAL_FAILURE");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new AppError("TERMINAL_FAILURE");
  }
  return Object.freeze({ bytes, mimeType: mimeType.toLowerCase() });
}

function findImage(response: GeminiResponse, maxBytes: number): ImageResult {
  if (!response || !Array.isArray(response.candidates)) throw new AppError("TERMINAL_FAILURE");
  for (const candidate of response.candidates) {
    for (const part of candidate.content?.parts ?? []) {
      const inlineData = part.inlineData ?? part.inline_data;
      if (!inlineData) continue;
      return decodeImage(inlineData.data, inlineData.mimeType ?? inlineData.mime_type, maxBytes);
    }
  }
  throw new AppError("TERMINAL_FAILURE");
}

export class GeminiImageProvider implements ImageProvider {
  constructor(
    private readonly config: ImageProviderConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  async generate(prompt: string): Promise<ImageResult> {
    const model = this.config.model.trim();
    const apiKey = this.config.apiKey.trim();
    if (!model || !apiKey) throw new AppError("CONFIGURATION_ERROR");

    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = this.config.maxBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new AppError("CONFIGURATION_ERROR");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.request(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
          signal: controller.signal,
        });
      } catch {
        throw new AppError("TRANSIENT_FAILURE");
      }
      if (!response.ok) throw errorForStatus(response.status);
      let payload: GeminiResponse;
      try {
        payload = (await response.json()) as GeminiResponse;
      } catch {
        throw new AppError("TERMINAL_FAILURE");
      }
      return findImage(payload, maxBytes);
    } finally {
      clearTimeout(timer);
    }
  }
}
