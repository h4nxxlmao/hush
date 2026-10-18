import { createRequire } from "node:module";

/** Single source of truth is cli/package.json; this reads it at runtime. */
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };

export const version = pkg.version ?? "0.0.0";
