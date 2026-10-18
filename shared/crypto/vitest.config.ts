import { defineConfig } from "vitest/config";

/**
 * Argon2id runs inside wasm here and wall-clock time varies a lot with machine
 * load (measured between ~150 ms and ~12 s per derivation on the same box).
 * Generous timeouts keep correctness tests from flaking on slow moments; the
 * parameter choice itself is asserted in the tests.
 */
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
