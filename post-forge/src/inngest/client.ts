import "server-only";

import { EventSchemas, Inngest } from "inngest";
import { AppError, classifyError } from "../lib/errors";
import { getServerConfig, type ServerConfig } from "../lib/config";
import {
  GENERATION_REQUESTED_EVENT,
  generationRequestedEventSchema,
  type GenerationRequestedData,
  type GenerationRequestedEvent,
} from "./events";

type Environment = Readonly<Record<string, string | undefined>>;
type FetchLike = typeof fetch;

const CLOUD_BASE_URL = "https://inn.gs";
const DEV_BASE_URL = "http://127.0.0.1:8288";
const DEV_EVENT_KEY = "postforge-dev";

const eventSchemas = new EventSchemas().fromRecord<{
  [GENERATION_REQUESTED_EVENT]: { data: GenerationRequestedData };
}>();

export type InngestClient = Inngest;

export function getInngestEventEndpoint(config: ServerConfig): string {
  const baseUrl = config.inngest.isDev ? DEV_BASE_URL : CLOUD_BASE_URL;
  const eventKey = config.inngest.eventKey ?? DEV_EVENT_KEY;
  return `${baseUrl}/e/${encodeURIComponent(eventKey)}`;
}

function mapSdkError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : "";
  const status = Number(message.match(/Inngest API Error: (\d{3})/)?.[1]);
  if (status === 401 || status === 403) return new AppError("CONFIGURATION_ERROR");
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
    return new AppError("TRANSIENT_FAILURE");
  }
  return new AppError(classifyError(error));
}

/** Create the single server-side event sender used by later dispatch tasks. */
export function createInngestClient(options: {
  config?: ServerConfig;
  env?: Environment;
  fetch?: FetchLike;
} = {}): InngestClient {
  const config = options.config ?? getServerConfig(options.env);
  const client = new Inngest({
    id: "post-forge",
    baseUrl: config.inngest.isDev ? DEV_BASE_URL : CLOUD_BASE_URL,
    eventKey: config.inngest.eventKey ?? DEV_EVENT_KEY,
    isDev: config.inngest.isDev,
    schemas: eventSchemas,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "send") return Reflect.get(target, property, receiver);
      return async (value: GenerationRequestedEvent) => {
        const event = generationRequestedEventSchema.parse(value);
        try {
          const result = await target.send(event);
          return Object.freeze({ ids: Object.freeze([...result.ids]) });
        } catch (error) {
          throw mapSdkError(error);
        }
      };
    },
  });
}

export const inngest = createInngestClient;
