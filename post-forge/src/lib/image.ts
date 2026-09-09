import "server-only";

import { AppError } from "./errors";
import { GeminiImageProvider } from "./image-providers/gemini";

export type ImageProviderName = "gemini";

export type ImageResult = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
}>;

export type ImageProviderConfig = Readonly<{
  provider: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
  maxBytes?: number;
}>;

export type ImageProviderDependencies = Readonly<{
  fetch?: typeof fetch;
}>;

export interface ImageProvider {
  generate(prompt: string): Promise<ImageResult>;
}

/**
 * Construct the configured image adapter. Provider selection is deliberately
 * kept here so adding an adapter never requires changes to an agent.
 */
export function getImageProvider(
  config: ImageProviderConfig,
  dependencies: ImageProviderDependencies = {},
): ImageProvider {
  if (config.provider !== "gemini") {
    throw new AppError("CONFIGURATION_ERROR");
  }
  return new GeminiImageProvider(config, dependencies.fetch ?? fetch);
}

export async function generateImage(
  prompt: string,
  config: ImageProviderConfig,
  dependencies: ImageProviderDependencies = {},
): Promise<ImageResult> {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new AppError("INVALID_INPUT");
  }
  return getImageProvider(config, dependencies).generate(prompt);
}
