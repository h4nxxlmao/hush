import sodium from "libsodium-wrappers-sumo";
import { CRYPTO } from "@hush/schemas/constants";
import { fromBase64, toBase64 } from "./encoding";
import { CryptoError } from "./errors";

/**
 * Project key wrapping.
 *
 * A project key is 32 random bytes generated client-side on `hush init`. It is
 * delivered to each member as an anonymous sealed box (`crypto_box_seal`) against
 * that member's X25519 public key. The server stores one sealed blob per member and
 * cannot open any of them.
 */

export async function generateProjectKey(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(CRYPTO.PROJECT_KEY_BYTES);
}

function assertProjectKey(projectKey: Uint8Array): void {
  if (projectKey.length !== CRYPTO.PROJECT_KEY_BYTES) {
    throw new CryptoError("invalid_key", "Project key must be 32 bytes.");
  }
}

function parsePublicKey(publicKeyBase64: string): Uint8Array {
  let publicKey: Uint8Array;
  try {
    publicKey = fromBase64(publicKeyBase64);
  } catch {
    throw new CryptoError("invalid_input", "Public key is not valid base64.");
  }
  if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new CryptoError("invalid_input", "Public key must be 32 bytes.");
  }
  return publicKey;
}

/** Wrap the project key for one member. Returns the base64 sealed blob to store server-side. */
export async function wrapProjectKeyForMember(
  projectKey: Uint8Array,
  memberPublicKeyBase64: string,
): Promise<string> {
  await sodium.ready;
  assertProjectKey(projectKey);
  const publicKey = parsePublicKey(memberPublicKeyBase64);
  return toBase64(sodium.crypto_box_seal(projectKey, publicKey));
}

/** Open a wrapped project key with the member's private key. */
export async function unwrapProjectKey(
  wrappedProjectKeyBase64: string,
  memberPublicKeyBase64: string,
  memberPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  const publicKey = parsePublicKey(memberPublicKeyBase64);
  if (memberPrivateKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new CryptoError("invalid_key", "Private key must be 32 bytes.");
  }
  let wrapped: Uint8Array;
  try {
    wrapped = fromBase64(wrappedProjectKeyBase64);
  } catch {
    throw new CryptoError("invalid_input", "Wrapped key is not valid base64.");
  }
  try {
    const projectKey = sodium.crypto_box_seal_open(wrapped, publicKey, memberPrivateKey);
    assertProjectKey(projectKey);
    return projectKey;
  } catch {
    throw new CryptoError("invalid_key", "This project key is not addressed to your account.");
  }
}
