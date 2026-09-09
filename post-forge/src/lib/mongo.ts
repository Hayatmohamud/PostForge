import "server-only";
import {
  MongoClient, MongoNetworkError, MongoOperationTimeoutError, MongoServerSelectionError,
  type Db,
} from "mongodb";
import { ConfigurationError, getServerConfig } from "./config";
import { AppError, classifyError, readDiagnosticField } from "./errors";
import { createLogger } from "./logging";

type Environment = Readonly<Record<string, string | undefined>>;
type Connection = { client: MongoClient; connected: Promise<MongoClient> };
const mongoGlobal = globalThis as typeof globalThis & {
  __postforgeMongoConnectionsV1?: Map<string, Connection>;
};
const connections = mongoGlobal.__postforgeMongoConnectionsV1 ??= new Map<string, Connection>();
const log = createLogger();

function assertTestIsolation(env: Environment, uri: string, db: string): void {
  // Check actual worker markers too: an injected env cannot disguise a test as
  // production. Test URI/database must be explicitly configured and agree.
  if (process.env.NODE_ENV !== "test" && process.env.POSTFORGE_TEST_MODE === undefined &&
      env.NODE_ENV !== "test" && env.POSTFORGE_TEST_MODE === undefined) return;
  const testUri = env.TEST_MONGODB_URI?.trim();
  const testDb = env.TEST_MONGODB_DB?.trim();
  const match = /^mongodb:\/\/(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})\/?$/.exec(testUri ?? "");
  if (!testUri || !match || Number(match[2]) < 1 || Number(match[2]) > 65_535 || uri !== testUri) {
    throw new ConfigurationError(["TEST_MONGODB_URI", "MONGODB_URI"]);
  }
  if (!testDb || !/^postforge_test_[a-z0-9_]+$/.test(testDb) || testDb.length > 63 || db !== testDb) {
    throw new ConfigurationError(["TEST_MONGODB_DB", "MONGODB_DB"]);
  }
}

function safeConnectionError(error: unknown): AppError {
  const code = readDiagnosticField(error, "code");
  if (code === 13 || code === 18) return new AppError("CONFIGURATION_ERROR");
  if (error instanceof MongoNetworkError || error instanceof MongoServerSelectionError || error instanceof MongoOperationTimeoutError) {
    return new AppError("TRANSIENT_FAILURE");
  }
  // Do not attach a driver cause: its message/connection description may contain
  // credentials even when the top-level message has already been sanitized.
  return new AppError(classifyError(error));
}

/**
 * Lazy Node.js database connection. Uses validated server configuration and an
 * explicit database name; URI-embedded default database names are never used.
 * Concurrent callers and development module reloads reuse the same client pool.
 * In tests, supply TEST_MONGODB_URI/DB and matching MONGODB_URI/DB explicitly.
 * Do not pass request/user input as env or close the pool after individual calls.
 */
export async function getMongoDatabase(env: Environment = process.env): Promise<Db> {
  const config = getServerConfig(env);
  const { uri, db } = config.mongodb;
  assertTestIsolation(env, uri, db);
  const timeoutMs = config.limits.databaseTimeoutMs;
  // Pools are distinct for changed credentials, deployment, or timeout policy.
  // Database handles on one deployment can share that pool. Never log this key.
  const key = JSON.stringify([uri, timeoutMs]);
  let connection = connections.get(key);
  if (!connection) {
    let client: MongoClient;
    try {
      client = new MongoClient(uri, {
        connectTimeoutMS: timeoutMs,
        serverSelectionTimeoutMS: timeoutMs,
        waitQueueTimeoutMS: timeoutMs,
        timeoutMS: timeoutMs,
        // Driver command logging could include raw documents or credentials.
        mongodbLogComponentSeverities: {
          default: "off", command: "off", topology: "off",
          serverSelection: "off", connection: "off", client: "off",
        },
      });
    } catch {
      throw new AppError("CONFIGURATION_ERROR");
    }
    const entry: Connection = {
      client,
      // Defer connect until the cache entry exists, including synchronous throws.
      connected: Promise.resolve().then(() => client.connect()).catch(async (error: unknown) => {
        if (connections.get(key) === entry) connections.delete(key);
        try { await client.close(); } catch { /* Never expose cleanup errors. */ }
        const safeError = safeConnectionError(error);
        log({ level: "error", event: "operation.failed", error: safeError });
        throw safeError;
      }),
    };
    connections.set(key, entry);
    connection = entry;
  }
  const client = await connection.connected;
  try {
    return client.db(db);
  } catch {
    throw new AppError("CONFIGURATION_ERROR");
  }
}

/** Shutdown/test cleanup only; never invoke while serving active requests. */
export async function closeMongoConnections(): Promise<void> {
  const entries = [...connections.values()];
  connections.clear();
  const results = await Promise.allSettled(entries.map(async ({ client, connected }) => {
    try { await connected; } catch { return; } // Failed connects already close themselves.
    await client.close();
  }));
  if (results.some((result) => result.status === "rejected")) {
    throw new AppError("TERMINAL_FAILURE");
  }
}
