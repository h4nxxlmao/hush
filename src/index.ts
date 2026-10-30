#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { runMain } from "citty";
import { reportError } from "./lib/command";
import { mainCommand } from "./main";

/**
 * hush, zero-knowledge .env sync.
 * Everything is encrypted on this machine; the server stores ciphertext only.
 */
void runMain(mainCommand).catch((error: unknown) => {
  reportError(error);
});
