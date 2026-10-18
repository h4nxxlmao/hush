import sodium from "libsodium-wrappers-sumo";
import type { KdfParams } from "@hush/schemas/entities";
import { concatBytes, fromBase64, toBase64 } from "./encoding";
import { CryptoError } from "./errors";
import { defaultKdfParams, deriveKeyFromPassphrase, generateKdfSalt } from "./kdf";
import {
  generateRecoveryKey,
  openPrivateKeyWithRecoveryKey,
  recoveryKeyHash,
  sealPrivateKeyWithRecoveryKey,
} from "./recovery";

/**
 * User keypair lifecycle.
 *
 * The X25519 private key never leaves the device in plaintext. Two independent
 * copies are stored server-side:
 *   1. sealed with a key derived from the passphrase (Argon2id), and
 *   2. sealed under the recovery key shown to the user once.
 * The server can store both blobs without being able to open either.
 */

export interface UserKeyMaterial {
  publicKey: string;
  encryptedPrivateKey: string;
  encryptedPrivateKeyRecovery: string;
  kdfSalt: string;
  kdfParams: KdfParams;
  recoveryKeyHash: string;
  /** Display form, shown exactly once. Never uploaded, never logged. */
  recoveryKey: string;
  /** Decrypted private key, so the caller can cache it without a second KDF run. Zero it when done. */
  privateKey: Uint8Array;
}

export async function createUserKeyMaterial(passphrase: string): Promise<UserKeyMaterial> {
  await sodium.ready;
  if (passphrase.length < 8) {
    throw new CryptoError("invalid_input", "Passphrase must be at least 8 characters.");
  }
  const keypair = sodium.crypto_box_keypair();
  const kdfParams = await defaultKdfParams();
  const kdfSalt = await generateKdfSalt();
  const encryptedPrivateKey = await sealPrivateKeyWithPassphrase(
    keypair.privateKey,
    passphrase,
    kdfSalt,
    kdfParams,
  );

  const recovery = await generateRecoveryKey();
  const encryptedPrivateKeyRecovery = await sealPrivateKeyWithRecoveryKey(
    keypair.privateKey,
    recovery.canonical,
  );
  const hash = await recoveryKeyHash(recovery.canonical);

  return {
    publicKey: toBase64(keypair.publicKey),
    encryptedPrivateKey,
    encryptedPrivateKeyRecovery,
    kdfSalt: toBase64(kdfSalt),
    kdfParams,
    recoveryKeyHash: hash,
    recoveryKey: recovery.display,
    privateKey: keypair.privateKey,
  };
}

/**
 * Seal the private key under a passphrase-derived key. Blob layout: nonce (24) || secretbox.
 * Used at signup and whenever the passphrase changes (CLI or browser).
 */
export async function sealPrivateKeyWithPassphrase(
  privateKey: Uint8Array,
  passphrase: string,
  kdfSalt: Uint8Array,
  kdfParams: KdfParams,
): Promise<string> {
  await sodium.ready;
  const derivedKey = await deriveKeyFromPassphrase(passphrase, kdfSalt, kdfParams);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const box = sodium.crypto_secretbox_easy(privateKey, nonce, derivedKey);
  sodium.memzero(derivedKey);
  return toBase64(concatBytes(nonce, box));
}

/** Open the passphrase-sealed private key. Throws CryptoError("decrypt_failed") on a wrong passphrase. */
export async function openPrivateKeyWithPassphrase(
  encryptedPrivateKeyBase64: string,
  passphrase: string,
  kdfSaltBase64: string,
  kdfParams: KdfParams,
): Promise<Uint8Array> {
  await sodium.ready;
  const salt = fromBase64(kdfSaltBase64);
  let blob: Uint8Array;
  try {
    blob = fromBase64(encryptedPrivateKeyBase64);
  } catch {
    throw new CryptoError("invalid_input", "Key blob is not valid base64.");
  }
  if (blob.length <= sodium.crypto_secretbox_NONCEBYTES) {
    throw new CryptoError("invalid_input", "Key blob is truncated.");
  }
  const nonce = blob.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  const box = blob.subarray(sodium.crypto_secretbox_NONCEBYTES);
  const derivedKey = await deriveKeyFromPassphrase(passphrase, salt, kdfParams);
  try {
    const privateKey = sodium.crypto_secretbox_open_easy(box, nonce, derivedKey);
    sodium.memzero(derivedKey);
    return privateKey;
  } catch {
    sodium.memzero(derivedKey);
    throw new CryptoError("decrypt_failed", "Wrong passphrase for this account.");
  }
}

/** Re-open the private key with the recovery key instead of the passphrase. */
export async function openPrivateKeyWithRecovery(
  encryptedPrivateKeyRecoveryBase64: string,
  recoveryKeyInput: string,
): Promise<Uint8Array> {
  return openPrivateKeyWithRecoveryKey(encryptedPrivateKeyRecoveryBase64, recoveryKeyInput);
}

/** Derive the X25519 public key from a private key (used by `hush key import` to sanity-check). */
export async function derivePublicKey(privateKey: Uint8Array): Promise<string> {
  await sodium.ready;
  if (privateKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new CryptoError("invalid_key", "Private key must be 32 bytes.");
  }
  return toBase64(sodium.crypto_scalarmult_base(privateKey));
}
