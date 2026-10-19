import sodium from "libsodium-wrappers-sumo";
import { CRYPTO } from "@hush/schemas/constants";
import { fromBase64, toBase64, toHex, utf8ToBytes } from "./encoding";
import { CryptoError } from "./errors";

/**
 * Env file sealing.
 *
 * The whole serialized file (key names included) is encrypted as one blob with
 * XChaCha20-Poly1305. The AAD binds the ciphertext to its exact coordinates ,
 * project, environment, version and key version, so a hostile server cannot
 * replay a `prod` blob into `dev`, or an old version into a new slot, without
 * decryption failing loudly on the client.
 */

export interface EnvAadParts {
  projectId: string;
  environmentName: string;
  version: number;
  keyVersion: number;
}

export interface SealedEnvFile {
  ciphertext: string;
  nonce: string;
  sizeBytes: number;
  contentHash: string;
  keyVersion: number;
}

/**
 * Domain separator for the keyed content hash.
 *
 * Deliberately still says "envhx": the string is part of the stored data format
 * (every contentHash in the database was derived with it) and changing it would
 * invalidate existing fingerprints. Same reasoning as the AAD: do not touch.
 */
const CONTENT_HASH_CONTEXT = "envhx:content-hash:v1";

export function buildEnvAad(parts: EnvAadParts): string {
  return `${parts.projectId}|${parts.environmentName}|${parts.version}|${parts.keyVersion}`;
}

function assertProjectKey(projectKey: Uint8Array): void {
  if (projectKey.length !== CRYPTO.PROJECT_KEY_BYTES) {
    throw new CryptoError("invalid_key", "Project key must be 32 bytes.");
  }
}

/**
 * Keyed BLAKE2b over the plaintext, under a subkey derived from the project key.
 * Lets clients and the server compare "same content?" without revealing anything,
 * and lets a push short-circuit when nothing changed.
 */
export async function computeContentHash(
  plaintextBytes: Uint8Array,
  projectKey: Uint8Array,
): Promise<string> {
  await sodium.ready;
  assertProjectKey(projectKey);
  const subkey = sodium.crypto_generichash(
    CRYPTO.CONTENT_HASH_BYTES,
    utf8ToBytes(CONTENT_HASH_CONTEXT),
    projectKey,
  );
  const digest = sodium.crypto_generichash(CRYPTO.CONTENT_HASH_BYTES, plaintextBytes, subkey);
  sodium.memzero(subkey);
  return toHex(digest);
}

export async function sealEnvFile(
  plaintextBytes: Uint8Array,
  projectKey: Uint8Array,
  parts: EnvAadParts,
): Promise<SealedEnvFile> {
  await sodium.ready;
  assertProjectKey(projectKey);
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const aad = buildEnvAad(parts);
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintextBytes,
    aad,
    null,
    nonce,
    projectKey,
  );
  const contentHash = await computeContentHash(plaintextBytes, projectKey);
  return {
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce),
    sizeBytes: plaintextBytes.length,
    contentHash,
    keyVersion: parts.keyVersion,
  };
}

/**
 * Open a sealed env file. Any mismatch, tampered bytes, wrong key, wrong AAD
 * coordinates, throws CryptoError("decrypt_failed") with a message that never
 * echoes key material.
 */
export async function openEnvFile(
  ciphertextBase64: string,
  nonceBase64: string,
  projectKey: Uint8Array,
  parts: EnvAadParts,
): Promise<Uint8Array> {
  await sodium.ready;
  assertProjectKey(projectKey);
  let ciphertext: Uint8Array;
  let nonce: Uint8Array;
  try {
    ciphertext = fromBase64(ciphertextBase64);
    nonce = fromBase64(nonceBase64);
  } catch {
    throw new CryptoError("invalid_input", "Ciphertext or nonce is not valid base64.");
  }
  if (nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) {
    throw new CryptoError("invalid_input", "Nonce must be 24 bytes.");
  }
  const aad = buildEnvAad(parts);
  try {
    // Note the wrappers' argument order: (secret_nonce, ciphertext, ad, public_nonce, key).
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aad,
      nonce,
      projectKey,
    );
  } catch {
    throw new CryptoError(
      "decrypt_failed",
      "Decryption failed. The data was tampered with, moved between environments, or the project key is wrong.",
    );
  }
}
