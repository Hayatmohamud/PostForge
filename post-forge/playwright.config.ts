import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.TEST_PORT ?? 3103);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("TEST_PORT must be an integer from 1024 through 65535.");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/playwright",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "browser", testDir: "./tests/browser" },
    { name: "e2e", testDir: "./tests/e2e" },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      ...(process.env.POSTFORGE_PROVIDER_FIXTURES ? { POSTFORGE_PROVIDER_FIXTURES: process.env.POSTFORGE_PROVIDER_FIXTURES } : {}),
      ...(process.env.POSTFORGE_PROVIDER_FIXTURE_SERVER ? { POSTFORGE_PROVIDER_FIXTURE_SERVER: process.env.POSTFORGE_PROVIDER_FIXTURE_SERVER } : {}),
      ...(process.env.POSTFORGE_PROVIDER_FIXTURE_PORT ? { POSTFORGE_PROVIDER_FIXTURE_PORT: process.env.POSTFORGE_PROVIDER_FIXTURE_PORT } : {}),
      ...(process.env.OPENROUTER_BASE_URL ? { OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL } : {}),
      ...(process.env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY } : {}),
      ...(process.env.OPENROUTER_MODEL ? { OPENROUTER_MODEL: process.env.OPENROUTER_MODEL } : {}),
      ...(process.env.SERPER_API_KEY ? { SERPER_API_KEY: process.env.SERPER_API_KEY } : {}),
      ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
      ...(process.env.IMAGE_PROVIDER ? { IMAGE_PROVIDER: process.env.IMAGE_PROVIDER } : {}),
      ...(process.env.IMAGE_MODEL ? { IMAGE_MODEL: process.env.IMAGE_MODEL } : {}),
      ...(process.env.INNGEST_DEV ? { INNGEST_DEV: process.env.INNGEST_DEV } : {}),
      ...(process.env.MONGODB_URI ? { MONGODB_URI: process.env.MONGODB_URI } : {}),
      ...(process.env.MONGODB_DB ? { MONGODB_DB: process.env.MONGODB_DB } : {}),
      ...(process.env.TEST_MONGODB_URI ? { TEST_MONGODB_URI: process.env.TEST_MONGODB_URI } : {}),
      ...(process.env.TEST_MONGODB_DB ? { TEST_MONGODB_DB: process.env.TEST_MONGODB_DB } : {}),
      ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),
    },
  },
});
