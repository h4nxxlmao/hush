import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isCancel } from "@clack/prompts";
import {
  derivePublicKey,
  openPrivateKeyWithPassphrase,
  openPrivateKeyWithRecovery,
  toBase64,
} from "@hush/crypto";
import { api, type MeKeysResponse } from "@hush/schemas";
import { defineCommand } from "citty";
import { globalArgs, requireClient, requireInteractive, runWithArgs } from "../lib/command";
import { CliError } from "../lib/errors";
import { askPassphrase, cachePrivateKey } from "../lib/session";
import { writeFileNoFollow } from "../lib/safe-write";
import { readIdentity, statePath } from "../lib/state";
import { info, isJsonMode, printJson, success } from "../lib/ui";

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
    out: {
      type: "string",
      alias: "o",
      description: "Output file (default: ~/.config/hush/hush-key.json)",
    },
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
      const path = args.out
        ? resolve(process.cwd(), String(args.out))
        : statePath("hush-key.json");
      writeFileNoFollow(path, `${JSON.stringify(payload, null, 2)}\n`, 0o600);
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
    file: {
      type: "string",
      alias: "f",
      description: "Exported key file (default: ~/.config/hush/hush-key.json)",
    },
    recovery: {
      type: "boolean",
      description: "Unseal with the recovery key instead of the passphrase",
      default: false,
    },
  },
  run: async ({ args }) => {
    await runWithArgs(args, async () => {
      const path = args.file
        ? resolve(process.cwd(), String(args.file))
        : statePath("hush-key.json");
      let payload: KeyExportFile;
      try {
        payload = JSON.parse(readFileSync(path, "utf8")) as KeyExportFile;
      } catch {
        throw CliError.usage(`Could not read ${args.file}.`, "Export one with `hush key export`.");
      }
      if (payload.version !== 1 || !payload.encryptedPrivateKey || !payload.publicKey) {
        throw CliError.usage("That file is not an hush key export.");
      }
      if (!payload.kdfSalt || !payload.kdfParams) {
        throw CliError.usage(
          "That key export is missing its KDF parameters.",
          "Use `hush key export` from a current CLI.",
        );
      }
      requireInteractive("unlock a key interactively");

      const identity = readIdentity();
      if (identity && payload.userId && identity.userId !== payload.userId) {
        throw CliError.auth(
          "This key belongs to a different account.",
          "Log out first, or import it on the account that owns it.",
        );
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

      const derived = await derivePublicKey(privateKey);
      if (derived !== payload.publicKey) {
        throw CliError.auth(
          "The imported private key does not match its public key.",
          "Refusing to cache a key that would wrap new projects to the wrong key.",
        );
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
