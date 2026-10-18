import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    // The e2e suite needs a running backend and is run explicitly with
    // vitest.e2e.config.ts — unit tests stay hermetic and fast.
    exclude: ["tests/e2e/**"],
  },
});
