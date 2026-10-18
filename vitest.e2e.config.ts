import { defineConfig } from "vitest/config";

/** E2E: the built CLI against a live local backend. Opt-in (`pnpm test:e2e`). */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
