import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isCancel } from "@clack/prompts";
import {
  openPrivateKeyWithPassphrase,
  openPrivateKeyWithRecovery,
  toBase64,
} from "@hush/crypto";
import { api, type MeKeysResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, requireClient, requireInteractive, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import { askPassphrase, cachePrivateKey } from "../lib/session";
import { readIdentity } from "../lib/state";
import { info, isJsonMode, printJson, success, warn } from "../lib/ui";

/**
 * `hush key export/import`, move the key to another machine.
 *
 * The export file contains the *sealed* private key (the same ciphertext the
 * server holds). It is safe to move over any channel: without the passphrase it
 * is useless. Import decrypts it locally and caches it.
 */

interface KeyExportFile {
  version: 1;
  exportedAt: string;
  userId: string | null;
  publicKey: string;
  kdfSalt: string;
  kdfParams: { algorithm: "argon2id"; opslimit: number; memlimit: number };
  encryptedPrivateKey: string;
  encryptedPrivateKeyRecovery: string;
  recoveryKeyHash: string;
  apiUrl: string;
}

const keyExportCommand = defineCommand({
  meta: { name: "export", description: "Write your sealed key to a portable file" },
  args: {
    ...globalArgs,
    out: { type: "string", alias: "o", description: "Output file", default: "hush-key.json" },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const client = await requireClient(args);
      const { keys } = await client.get<MeKeysResponse>(api.me.keys());
      if (!keys) {
        throw CliError.auth("This account has no keys yet.", "Run `hush login` first.");
      }
      const identity = readIdentity();
      const payload: KeyExportFile = {
        version: 1,
        exportedAt: new Date().toISOString(),
        userId: identity?.userId ?? null,
        publicKey: keys.publicKey,
        kdfSalt: keys.kdfSalt,
        kdfParams: keys.kdfParams,
        encryptedPrivateKey: keys.encryptedPrivateKey,
        encryptedPrivateKeyRecovery: keys.encryptedPrivateKeyRecovery,
        recoveryKeyHash: keys.recoveryKeyHash,
        apiUrl: client.baseUrl,
      };
      const path = resolve(process.cwd(), String(args.out));
      writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      if (isJsonMode()) {
        printJson({ exported: true, file: path, publicKey: keys.publicKey });
        return;
      }
      success(`Exported your sealed key to ${path}.`);
      info("It is ciphertext, safe to carry, useless without your passphrase.");
    });
  },
});

const keyImportCommand = defineCommand({
  meta: { name: "import", description: "Load your sealed key from a file and unlock it here" },
  args: {
    ...globalArgs,
    file: { type: "string", alias: "f", description: "Exported key file", default: "hush-key.json" },
    recovery: {
      type: "boolean",
      description: "Unseal with the recovery key instead of the passphrase",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const path = resolve(process.cwd(), String(args.file));
      let payload: KeyExportFile;
      try {
        payload = JSON.parse(readFileSync(path, "utf8")) as KeyExportFile;
      } catch {
        throw CliError.usage(`Could not read ${args.file}.`, "Export one with `hush key export`.");
      }
      if (payload.version !== 1 || !payload.encryptedPrivateKey || !payload.publicKey) {
        throw CliError.usage("That file is not an hush key export.");
      }
      requireInteractive("unlock a key interactively");

      const identity = readIdentity();
      if (identity && payload.userId && identity.userId !== payload.userId) {
        warn("This key belongs to a different account. It will be cached, but pushes would fail.");
      }

      let privateKey: Uint8Array;
      try {
        if (args.recovery) {
          const recoveryKey = await askPassphrase("Recovery key (XXXX-XXXX-…)");
          privateKey = await openPrivateKeyWithRecovery(
            payload.encryptedPrivateKeyRecovery,
            recoveryKey,
          );
        } else {
          const passphrase = await askPassphrase("Passphrase");
          privateKey = await openPrivateKeyWithPassphrase(
            payload.encryptedPrivateKey,
            passphrase,
            payload.kdfSalt,
            payload.kdfParams,
          );
        }
      } catch (error) {
        if (isCancel(error)) {
          throw new CliError("Cancelled.");
        }
        throw CliError.auth("Could not unseal that key.", "Check the passphrase and try again.");
      }

      await cachePrivateKey({
        userId: payload.userId ?? identity?.userId ?? "",
        publicKey: payload.publicKey,
        privateKey: toBase64(privateKey),
      });
      if (isJsonMode()) {
        printJson({ imported: true, file: path, publicKey: payload.publicKey });
        return;
      }
      success("Key imported and cached. `hush lock` clears it again.");
    });
  },
});

export const keyCommand = defineCommand({
  meta: { name: "key", description: "Move your unlocked key between machines" },
  subCommands: { export: keyExportCommand, import: keyImportCommand },
  run: () => {
    console.log("Usage: hush key <export|import> [--out file] [--recovery]");
  },
});
