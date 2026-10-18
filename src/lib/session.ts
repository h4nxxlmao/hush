import { isCancel, password as promptPassword } from "@clack/prompts";
import {
  createUserKeyMaterial,
  fromBase64,
  openPrivateKeyWithPassphrase,
  openPrivateKeyWithRecovery,
  toBase64,
  type UserKeyMaterial,
} from "@hush/crypto";
import { api, type MeKeys, type MeKeysResponse, type MeResponse } from "@hush/schemas";
import type { ApiClient } from "./api";
import { CliError } from "./errors";
import { getSecret, setSecret, deleteSecret } from "./keychain";
import { readIdentity, writeIdentity, type Identity } from "./state";

/**
 * Session and key handling.
 *
 * - The CLI token lives in the OS keychain (file fallback).
 * - The decrypted private key is cached after the first unlock, exactly as the
 *   spec describes, and `hush lock` clears it.
 * - HUSH_TOKEN exists for tests and scripted setups; it is read last.
 */

const TOKEN_ACCOUNT = "cli-token";
const KEY_ACCOUNT = "private-key";

export async function loadToken(): Promise<string | null> {
  const stored = await getSecret(TOKEN_ACCOUNT);
  if (stored?.value?.trim()) {
    return stored.value.trim();
  }
  const fromEnv = process.env.HUSH_TOKEN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

export async function saveToken(token: string): Promise<void> {
  await setSecret(TOKEN_ACCOUNT, token);
}

export async function clearToken(): Promise<void> {
  await deleteSecret(TOKEN_ACCOUNT);
}

export interface CachedPrivateKey {
  userId: string;
  publicKey: string;
  privateKey: string;
  cachedAt: string;
}

export async function loadCachedPrivateKey(): Promise<CachedPrivateKey | null> {
  const stored = await getSecret(KEY_ACCOUNT);
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored.value) as CachedPrivateKey;
    if (parsed.privateKey && parsed.publicKey) {
      return parsed;
    }
  } catch {
    // corrupt cache: treat as locked
  }
  return null;
}

export async function cachePrivateKey(entry: Omit<CachedPrivateKey, "cachedAt">): Promise<void> {
  await setSecret(
    KEY_ACCOUNT,
    JSON.stringify({ ...entry, cachedAt: new Date().toISOString() } satisfies CachedPrivateKey),
  );
}

export async function clearPrivateKeyCache(): Promise<void> {
  await deleteSecret(KEY_ACCOUNT);
}

export async function askPassphrase(message = "Passphrase"): Promise<string> {
  const value = await promptPassword({ message, validate: (input) => (input && input.length > 0 ? undefined : "Required") });
  if (isCancel(value)) {
    throw new CliError("Cancelled.", 1);
  }
  return String(value);
}

export async function loadIdentity(client: ApiClient, refresh = false): Promise<Identity> {
  if (!refresh) {
    const cached = readIdentity();
    if (cached) {
      return cached;
    }
  }
  const me = await client.get<MeResponse>(api.me.get());
  const identity: Identity = {
    userId: me.user.id,
    tokenName: process.env.HUSH_DEVICE_NAME?.trim() || "CLI device",
    githubUsername: me.user.githubUsername,
    name: me.user.name,
    avatarUrl: me.user.avatarUrl,
  };
  writeIdentity(identity);
  return identity;
}

export interface PrivateKeyHandle {
  privateKey: Uint8Array;
  publicKey: string;
  userId: string;
}

/**
 * Unlock: cached key -> passphrase (or recovery key) prompt -> decrypt the
 * sealed blob from the server -> cache. Nothing is written to the project.
 */
export async function requirePrivateKey(
  client: ApiClient,
  options: { prompt?: boolean; recoveryKey?: string } = {},
): Promise<PrivateKeyHandle> {
  const cached = await loadCachedPrivateKey();
  if (cached) {
    return {
      privateKey: fromBase64(cached.privateKey),
      publicKey: cached.publicKey,
      userId: cached.userId,
    };
  }

  const response = await client.get<MeKeysResponse>(api.me.keys());
  const keys: MeKeys | null = response.keys;
  if (!keys) {
    throw CliError.auth(
      "This account has no keys yet.",
      "Run `hush login` again to create them (that happens on first login).",
    );
  }

  if (!options.prompt && !options.recoveryKey) {
    throw CliError.auth(
      "Your key is locked on this machine.",
      "Run `hush unlock` first (or `hush login` on a new machine).",
    );
  }
  // Never prompt when there is no terminal to answer: CI and piped runs should
  // get an actionable error instead of a hang.
  if (!options.recoveryKey && !(process.stdin.isTTY && process.stdout.isTTY)) {
    throw CliError.auth(
      "Your key is locked and this shell is not interactive.",
      "Run `hush unlock` in a terminal, or `hush key import` with the recovery key.",
    );
  }

  let privateKey: Uint8Array;
  try {
    if (options.recoveryKey) {
      privateKey = await openPrivateKeyWithRecovery(
        keys.encryptedPrivateKeyRecovery,
        options.recoveryKey,
      );
    } else {
      const passphrase = await askPassphrase("Passphrase");
      privateKey = await openPrivateKeyWithPassphrase(
        keys.encryptedPrivateKey,
        passphrase,
        keys.kdfSalt,
        keys.kdfParams,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("recovery")
        ? "That recovery key does not match this account."
        : "Wrong passphrase.";
    throw CliError.auth(message, "Nothing was changed. Try again, or use --recovery-key.");
  }

  const identity = readIdentity();
  await cachePrivateKey({
    userId: identity?.userId ?? "",
    publicKey: keys.publicKey,
    privateKey: toBase64(privateKey),
  });
  return { privateKey, publicKey: keys.publicKey, userId: identity?.userId ?? "" };
}

/** First-login key setup: generate, seal twice, upload, cache, show recovery key once. */
export async function setupUserKeys(
  client: ApiClient,
  options: { passphrase: string; userId: string },
): Promise<UserKeyMaterial> {
  const material = await createUserKeyMaterial(options.passphrase);
  await client.request("PUT", api.me.keys(), {
    body: {
      publicKey: material.publicKey,
      encryptedPrivateKey: material.encryptedPrivateKey,
      encryptedPrivateKeyRecovery: material.encryptedPrivateKeyRecovery,
      kdfSalt: material.kdfSalt,
      kdfParams: material.kdfParams,
      recoveryKeyHash: material.recoveryKeyHash,
    },
  });
  await cachePrivateKey({
    userId: options.userId,
    publicKey: material.publicKey,
    privateKey: toBase64(material.privateKey),
  });
  return material;
}
