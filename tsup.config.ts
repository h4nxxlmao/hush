import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  dts: false,
  /**
   * The published CLI must be self-contained: workspace packages are TypeScript
   * source, and libsodium ships its wasm inline, so all three get bundled.
   * Everything else stays a regular dependency.
   */
  noExternal: ["@hush/crypto", "@hush/schemas", "libsodium-wrappers-sumo", "libsodium-sumo"],
});
