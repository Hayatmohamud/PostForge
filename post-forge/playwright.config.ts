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
      POSTFORGE_TEST_MODE: "fixture",
      NEXT_TELEMETRY_DISABLED: "1",
      OPENROUTER_API_KEY: "",
      SERPER_API_KEY: "",
      GEMINI_API_KEY: "",
      INNGEST_EVENT_KEY: "",
      INNGEST_SIGNING_KEY: "",
      MONGODB_URI: "",
      MONGODB_DB: "",
    },
  },
});
