import { afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";

// Register handlers explicitly with fixtureServer.use(http.post(...)) in each
// test. No provider implementation, credentials, or live fallback is selected.
export const fixtureServer = setupServer();
fixtureServer.listen({ onUnhandledRequest: "error" });
afterEach(() => fixtureServer.resetHandlers());
afterAll(() => fixtureServer.close());

// Keep inherited development credentials out of offline test workers. This is
// test-only setup; production configuration belongs to its own planned task.
for (const name of [
  "OPENROUTER_API_KEY",
  "SERPER_API_KEY",
  "GEMINI_API_KEY",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "MONGODB_URI",
  "MONGODB_DB",
]) {
  delete process.env[name];
}

/**
 * Future database tests must opt into a dedicated local test database using
 * TEST_MONGODB_URI and TEST_MONGODB_DB. Pick a unique name per worktree/run.
 * This helper validates configuration only; it never connects or drops data.
 * Restricted URI syntax intentionally excludes credentials, SRV, replica sets,
 * and URI options until a database task explicitly designs their test support.
 */
export function readTestDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const uri = env.TEST_MONGODB_URI?.trim();
  const dbName = env.TEST_MONGODB_DB?.trim();

  if (!uri || !dbName) {
    throw new Error("Set both TEST_MONGODB_URI and TEST_MONGODB_DB explicitly.");
  }
  if (!/^postforge_test_[a-z0-9_]+$/.test(dbName) || dbName.length > 63) {
    throw new Error("TEST_MONGODB_DB must be a dedicated postforge_test_* name.");
  }

  const match = /^mongodb:\/\/(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})\/?$/.exec(uri);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65_535) {
    throw new Error("TEST_MONGODB_URI must use a loopback host and explicit port, with no database, credentials, or options.");
  }

  return { uri, dbName };
}
