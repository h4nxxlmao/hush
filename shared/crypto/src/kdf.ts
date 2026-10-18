import sodium from "libsodium-wrappers-sumo";
import { KDF } from "@hush/schemas/constants";
import type { KdfParams } from "@hush/schemas/entities";
import { CryptoError } from "./errors";

/**
 * Argon2id key derivation for the user's passphrase. The parameters are chosen by
 * the client at setup time and stored (salt + params) so any device can re-derive.
 * The server never derives and never sees the passphrase.
 */

/**
 * Default parameters: libsodium's INTERACTIVE preset (opslimit 2, 64 MiB).
 * The spec allows interactive-or-higher; MODERATE (256 MiB) measures ~15 s per
 * derivation in the wasm build, which is unacceptable for `hush unlock` and the
 * browser unlock flow. Stored bounds allow up to SENSITIVE-level params for
 * accounts that want them.
 */
export async function defaultKdfParams(): Promise<KdfParams> {
  await sodium.ready;
  return {
    algorithm: KDF.ALGORITHM,
    opslimit: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    memlimit: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  };
}

export async function generateKdfSalt(): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.randombytes_buf(KDF.SALT_BYTES);
}

export function isKdfParamsWithinBounds(params: KdfParams): boolean {
  return (
    params.algorithm === KDF.ALGORITHM &&
    Number.isInteger(params.opslimit) &&
    params.opslimit >= KDF.MIN_OPSLIMIT &&
    params.opslimit <= KDF.MAX_OPSLIMIT &&
    Number.isInteger(params.memlimit) &&
    params.memlimit >= KDF.MIN_MEMLIMIT &&
    params.memlimit <= KDF.MAX_MEMLIMIT
  );
}

/**
 * Derive the 32-byte key that encrypts the private key at rest.
 * Never reuse the derived key for anything else.
 */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  await sodium.ready;
  if (passphrase.length === 0) {
    throw new CryptoError("invalid_input", "Passphrase must not be empty.");
  }
  if (salt.length !== KDF.SALT_BYTES) {
    throw new CryptoError("invalid_input", "KDF salt must be 16 bytes.");
  }
  if (!isKdfParamsWithinBounds(params)) {
    throw new CryptoError("invalid_input", "KDF parameters are outside the accepted bounds.");
  }
  return sodium.crypto_pwhash(
    KDF.KEY_BYTES,
    passphrase,
    salt,
    params.opslimit,
    params.memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}
