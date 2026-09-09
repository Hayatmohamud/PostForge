import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "unit",
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/helpers/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    env: { POSTFORGE_TEST_MODE: "fixture" },
  },
});
