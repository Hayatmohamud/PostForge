import { defineConfig } from "vitest/config";
import unitConfig from "./vitest.unit.config";

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    name: "integration",
    include: ["tests/integration/**/*.test.{ts,tsx}"],
    fileParallelism: false,
    testTimeout: 10_000,
  },
});
