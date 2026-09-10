import "server-only";

import { openai } from "@inngest/agent-kit";
import { getServerConfig, type ServerConfig } from "./config";
import { AppError } from "./errors";
import { modelSnapshotSchema, type ModelSnapshot } from "./contracts/post";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_PROVIDER = "openrouter" as const;

type Environment = Readonly<Record<string, string | undefined>>;

export type SavedModelSelection = ModelSnapshot & { provider: typeof OPENROUTER_PROVIDER };
export type TextModel = ReturnType<typeof openai>;

function selectModel(selection: SavedModelSelection | undefined, config: ServerConfig): string {
  if (!selection) return config.openrouter.model;
  const parsed = modelSnapshotSchema.safeParse(selection);
  if (!parsed.success || parsed.data.provider !== OPENROUTER_PROVIDER) throw new AppError("INVALID_INPUT");
  return parsed.data.model;
}

/** Create the one provider-neutral text model used by agents and resumed runs. */
export function createTextModel(selection?: SavedModelSelection, options: { config?: ServerConfig; env?: Environment } = {}): TextModel {
  const config = options.config ?? getServerConfig(options.env);
  return openai({
    model: selectModel(selection, config),
    apiKey: config.openrouter.apiKey,
    baseUrl: OPENROUTER_BASE_URL,
  });
}

export const createOpenRouterModel = createTextModel;
