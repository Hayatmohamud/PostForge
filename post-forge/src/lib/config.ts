import "server-only";

type Environment = Readonly<Record<string, string | undefined>>;

// Units, defaults, and inclusive override bounds live here, not in consumers.
// Attempt counts exclude the initial attempt; zero disables retries/corrections.
const limitDefinitions = {
  topicMaxChars: { env: "TOPIC_MAX_CHARS", default: 500, min: 1, max: 2_000 },
  articleMaxChars: { env: "ARTICLE_MAX_CHARS", default: 50_000, min: 1, max: 200_000 },
  searchMaxResults: { env: "SEARCH_MAX_RESULTS", default: 10, min: 1, max: 20 },
  findingsMaxCount: { env: "FINDINGS_MAX_COUNT", default: 50, min: 1, max: 100 },
  sourceMaxBytes: { env: "SOURCE_MAX_BYTES", default: 1_048_576, min: 1, max: 5_242_880 },
  posterMaxBytes: { env: "POSTER_MAX_BYTES", default: 10_485_760, min: 1, max: 20_971_520 },
  providerTimeoutMs: { env: "PROVIDER_TIMEOUT_MS", default: 30_000, min: 1_000, max: 120_000 },
  imageTimeoutMs: { env: "IMAGE_TIMEOUT_MS", default: 120_000, min: 1_000, max: 300_000 },
  databaseTimeoutMs: { env: "DATABASE_TIMEOUT_MS", default: 10_000, min: 1_000, max: 60_000 },
  stageCorrectionAttempts: { env: "STAGE_CORRECTION_ATTEMPTS", default: 2, min: 0, max: 3 },
  providerRetries: { env: "PROVIDER_RETRIES", default: 2, min: 0, max: 3 },
  networkMaxIterations: { env: "NETWORK_MAX_ITERATIONS", default: 36, min: 6, max: 60 },
} as const;

type OperationalLimits = Readonly<Record<keyof typeof limitDefinitions, number>>;

export class ConfigurationError extends Error {
  constructor(fields: readonly string[]) {
    // Only names selected by this module enter diagnostics. Never attach env,
    // input values, a provider exception, or a cause containing credentials.
    super(`Invalid server configuration: ${fields.join(", ")}. Check the server environment.`);
    this.name = "ConfigurationError";
  }
}

/** Validate at the beginning of each server entry point, before side effects. */
export function getServerConfig(env: Environment = process.env) {
  const invalid: string[] = [];
  function required(name: string): string {
    const value = env[name]?.trim();
    if (!value) invalid.push(name);
    return value ?? "";
  }

  const openrouter = Object.freeze({
    apiKey: required("OPENROUTER_API_KEY"),
    model: required("OPENROUTER_MODEL"),
  });
  const serperApiKey = required("SERPER_API_KEY");
  const geminiApiKey = required("GEMINI_API_KEY");
  const imageProvider = required("IMAGE_PROVIDER");
  if (imageProvider && imageProvider !== "gemini") invalid.push("IMAGE_PROVIDER");
  const imageModel = required("IMAGE_MODEL");
  const mongodb = Object.freeze({
    uri: required("MONGODB_URI"),
    db: required("MONGODB_DB"),
  });

  // Cloud is the default even for NODE_ENV=development. Skipping cloud keys
  // requires explicit selection of the local Inngest development server.
  const devValue = env.INNGEST_DEV?.trim();
  const isDev = devValue === "true" || devValue === "1";
  if (devValue !== undefined && !["true", "1", "false", "0"].includes(devValue)) {
    invalid.push("INNGEST_DEV");
  }
  const inngest = Object.freeze({
    isDev,
    eventKey: isDev ? env.INNGEST_EVENT_KEY?.trim() || undefined : required("INNGEST_EVENT_KEY"),
    signingKey: isDev ? env.INNGEST_SIGNING_KEY?.trim() || undefined : required("INNGEST_SIGNING_KEY"),
  });

  const limits = {} as Record<keyof typeof limitDefinitions, number>;
  for (const key of Object.keys(limitDefinitions) as (keyof typeof limitDefinitions)[]) {
    const definition = limitDefinitions[key];
    const raw = env[definition.env]?.trim();
    const value = raw === undefined ? definition.default : Number(raw);
    if (
      (raw !== undefined && !/^\d+$/.test(raw)) ||
      !Number.isSafeInteger(value) || value < definition.min || value > definition.max
    ) {
      invalid.push(definition.env);
    }
    limits[key] = value;
  }

  if (invalid.length) throw new ConfigurationError(invalid);

  return Object.freeze({
    openrouter,
    serperApiKey,
    image: Object.freeze({ provider: imageProvider as "gemini", model: imageModel, apiKey: geminiApiKey }),
    mongodb,
    inngest,
    limits: Object.freeze(limits) as OperationalLimits,
  });
}

export type ServerConfig = ReturnType<typeof getServerConfig>;
