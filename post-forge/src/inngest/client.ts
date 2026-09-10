import "server-only";

import { z } from "zod";
import { AppError, classifyError } from "../lib/errors";
import { getServerConfig, type ServerConfig } from "../lib/config";
import {
  generationRequestedEventSchema,
  type GenerationRequestedEvent,
} from "./events";

type Environment = Readonly<Record<string, string | undefined>>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const CLOUD_BASE_URL = "https://inn.gs";
const DEV_BASE_URL = "http://127.0.0.1:8288";
const DEV_EVENT_KEY = "postforge-dev";

const sendResponseSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
}).strict();

export type InngestClient = Readonly<{
  send(event: GenerationRequestedEvent): Promise<Readonly<{ ids: readonly string[] }>>;
}>;

export function getInngestEventEndpoint(config: ServerConfig): string {
  const baseUrl = config.inngest.isDev ? DEV_BASE_URL : CLOUD_BASE_URL;
  const eventKey = config.inngest.eventKey ?? DEV_EVENT_KEY;
  return `${baseUrl}/e/${encodeURIComponent(eventKey)}`;
}

function errorForResponse(status: number): AppError {
  if (status === 401 || status === 403) return new AppError("CONFIGURATION_ERROR");
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
    return new AppError("TRANSIENT_FAILURE");
  }
  return new AppError("TERMINAL_FAILURE");
}

/** Create the single server-side event sender used by later dispatch tasks. */
export function createInngestClient(options: {
  config?: ServerConfig;
  env?: Environment;
  fetch?: FetchLike;
} = {}): InngestClient {
  const config = options.config ?? getServerConfig(options.env);
  const request = options.fetch ?? fetch;
  const endpoint = getInngestEventEndpoint(config);
  const eventKey = config.inngest.eventKey;

  return Object.freeze({
    async send(value: GenerationRequestedEvent) {
      const event = generationRequestedEventSchema.parse(value);
      let response: Response;
      try {
        response = await request(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(eventKey ? { Authorization: `Bearer ${eventKey}` } : {}),
          },
          body: JSON.stringify(event),
        });
      } catch (error) {
        throw new AppError(classifyError(error));
      }

      if (!response.ok) throw errorForResponse(response.status);
      try {
        const payload = sendResponseSchema.parse(await response.json() as unknown);
        return Object.freeze({ ids: Object.freeze([...payload.ids]) });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("TERMINAL_FAILURE");
      }
    },
  });
}

export const inngest = createInngestClient;
