import { AsyncEntry } from "@napi-rs/keyring";
import { existsSync, readFileSync } from "node:fs";
import { writeFileNoFollow } from "./safe-write";
import { ensureStateDir, removeFile, statePath } from "./state";

/**
 * Secret storage: the OS keychain first, a 0600 file as the fallback (with a
 * warning). `HUSH_KEYCHAIN=file` forces the file backend, used by tests and
 * headless machines where the keychain isn't reachable.
 */

export const SERVICE = "hush";
/** Service name used before the rename; read once during migration. */
const LEGACY_SERVICE = "envhx";
const KEYFILE_NAME = "keyfile";

export type KeychainBackend = "os" | "file";

export interface StoredSecret {
  value: string;
  backend: KeychainBackend;
}

let fileWarningPrinted = false;

function forceFileBackend(): boolean {
  return process.env.HUSH_KEYCHAIN === "file";
}

function filePath(account: string): string {
  // The private-key cache lives in the spec-named file; other secrets get their
  // own files next to it.
  return account === "private-key" ? statePath(KEYFILE_NAME) : statePath(`${account}.secret`);
}

function writeFileSecret(account: string, value: string): void {
  ensureStateDir();
  const path = filePath(account);
  writeFileNoFollow(path, value, 0o600);
  if (!fileWarningPrinted) {
    fileWarningPrinted = true;
    console.error(
      "[hush] OS keychain unavailable, secrets are cached in ~/.config/hush with 0600 permissions.",
    );
  }
}

function readFileSecret(account: string): string | null {
  const path = filePath(account);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
}

export async function getSecret(account: string): Promise<StoredSecret | null> {
  if (!forceFileBackend()) {
    try {
      const entry = new AsyncEntry(SERVICE, account);
      const value = await entry.getPassword();
      if (value) {
        return { value, backend: "os" };
      }
    } catch {
      // fall through to the file backend
    }
    // Pre-rename installs stored the token and key cache under the old service
    // name; move them across once so nobody has to log in again.
    try {
      const legacyEntry = new AsyncEntry(LEGACY_SERVICE, account);
      const legacyValue = await legacyEntry.getPassword();
      if (legacyValue) {
        await setSecret(account, legacyValue);
        try {
          await legacyEntry.deleteCredential();
        } catch {
          // leaving a stale legacy entry behind is harmless
        }
        return { value: legacyValue, backend: "os" };
      }
    } catch {
      // no legacy entry
    }
  }
  const fileValue = readFileSecret(account);
  return fileValue ? { value: fileValue, backend: "file" } : null;
}

export async function setSecret(account: string, value: string): Promise<KeychainBackend> {
  if (!forceFileBackend()) {
    try {
      const entry = new AsyncEntry(SERVICE, account);
      await entry.setPassword(value);
      // Keep the fallback file out of sync on purpose: if the keychain works,
      // nothing sensitive is left on disk.
      removeFile(filePath(account));
      return "os";
    } catch {
      // fall through
    }
  }
  writeFileSecret(account, value);
  return "file";
}

export async function deleteSecret(account: string): Promise<void> {
  if (!forceFileBackend()) {
    try {
      const entry = new AsyncEntry(SERVICE, account);
      await entry.deleteCredential();
    } catch {
      // ignore
    }
  }
  removeFile(filePath(account));
}

export async function keychainStatus(): Promise<{ available: boolean; backend: KeychainBackend }> {
  if (forceFileBackend()) {
    return { available: false, backend: "file" };
  }
  try {
    const entry = new AsyncEntry(SERVICE, "__probe__");
    // A read that returns null still proves the store is reachable.
    await entry.getPassword();
    return { available: true, backend: "os" };
  } catch {
    return { available: false, backend: "file" };
  }
}
