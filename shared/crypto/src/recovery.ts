import sodium from "libsodium-wrappers-sumo";
import { KDF } from "@hush/schemas/constants";
import { concatBytes, fromBase64, toBase64, toHex } from "./encoding";
import { CryptoError } from "./errors";

/**
 * Recovery key handling.
 *
 * The recovery key is 32 random bytes shown to the user exactly once, encoded as
 * RFC 4648 base32 in dash-separated groups of four (no padding). The server stores
 * only SHA-256 of the canonical form, so a compromised server cannot derive the key
 * (256 bits of entropy makes an offline attack infeasible) but can verify the user
 * typed the right key without ever seeing it in usable form.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const GROUP_SIZE = 4;
const RECOVERY_KEY_BYTES = KDF.RECOVERY_KEY_BYTES;
/** ceil(32 bytes * 8 bits / 5 bits) = 52 characters. */
const CANONICAL_LENGTH = 52;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(input: string): Uint8Array {
  // Dashes and whitespace are display separators; anything else outside the
  // alphabet is a hard error (silently dropping characters would corrupt keys).
  if (!/^[A-Za-z2-7\s-]*$/.test(input)) {
    throw new CryptoError("invalid_input", "Invalid base32 character.");
  }
  const clean = input.replace(/[\s-]/g, "").toUpperCase();
  if (clean.length === 0) {
    return new Uint8Array(0);
  }
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new CryptoError("invalid_input", "Invalid base32 character.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** Group a canonical key for display: XXXX-XXXX-... */
export function formatRecoveryKey(canonical: string): string {
  const groups: string[] = [];
  for (let i = 0; i < canonical.length; i += GROUP_SIZE) {
    groups.push(canonical.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Normalize user input into the canonical form: uppercase, no spaces or dashes,
 * with common confusions (0->O, 1->I, 8->B, 9->G) corrected.
 */
export function normalizeRecoveryKey(input: string): string {
  const cleaned = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/8/g, "B")
    .replace(/9/g, "G");
  if (cleaned.length !== CANONICAL_LENGTH) {
    throw new CryptoError(
      "invalid_recovery_key",
      `Recovery keys are ${CANONICAL_LENGTH} characters (without dashes).`,
    );
  }
  return cleaned;
}

export async function generateRecoveryKey(): Promise<{ canonical: string; display: string }> {
  await sodium.ready;
  const bytes = sodium.randombytes_buf(RECOVERY_KEY_BYTES);
  const canonical = base32Encode(bytes);
  sodium.memzero(bytes);
  return { canonical, display: formatRecoveryKey(canonical) };
}

export async function recoveryKeyHash(canonical: string): Promise<string> {
  await sodium.ready;
  const normalized = normalizeRecoveryKey(canonical);
  const digest = sodium.crypto_hash_sha256(sodium.from_string(normalized));
  return toHex(digest);
}

/**
 * Encrypt the private key under the recovery key. Blob layout: nonce (24) || secretbox.
 */
export async function sealPrivateKeyWithRecoveryKey(
  privateKey: Uint8Array,
  canonical: string,
): Promise<string> {
  await sodium.ready;
  const normalized = normalizeRecoveryKey(canonical);
  const keyBytes = base32Decode(normalized);
  if (keyBytes.length !== RECOVERY_KEY_BYTES) {
    throw new CryptoError("invalid_recovery_key", "Recovery key must decode to 32 bytes.");
  }
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const box = sodium.crypto_secretbox_easy(privateKey, nonce, keyBytes);
  sodium.memzero(keyBytes);
  return toBase64(concatBytes(nonce, box));
}

/**
 * Decrypt the recovery-encrypted private key. Throws CryptoError("invalid_recovery_key")
 * when the key does not match (libsodium fails closed on MAC mismatch).
 */
export async function openPrivateKeyWithRecoveryKey(
  blobBase64: string,
  canonicalInput: string,
): Promise<Uint8Array> {
  await sodium.ready;
  let normalized: string;
  try {
    normalized = normalizeRecoveryKey(canonicalInput);
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    throw new CryptoError("invalid_recovery_key", "Recovery key has an invalid format.");
  }
  const keyBytes = base32Decode(normalized);
  if (keyBytes.length !== RECOVERY_KEY_BYTES) {
    throw new CryptoError("invalid_recovery_key", "Recovery key must decode to 32 bytes.");
  }
  let blob: Uint8Array;
  try {
    blob = fromBase64(blobBase64);
  } catch {
    throw new CryptoError("invalid_input", "Recovery blob is not valid base64.");
  }
  if (blob.length <= sodium.crypto_secretbox_NONCEBYTES) {
    throw new CryptoError("invalid_input", "Recovery blob is truncated.");
  }
  const nonce = blob.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  const box = blob.subarray(sodium.crypto_secretbox_NONCEBYTES);
  try {
    const privateKey = sodium.crypto_secretbox_open_easy(box, nonce, keyBytes);
    sodium.memzero(keyBytes);
    return privateKey;
  } catch {
    sodium.memzero(keyBytes);
    throw new CryptoError(
      "invalid_recovery_key",
      "That recovery key does not match this account.",
    );
  }
}
