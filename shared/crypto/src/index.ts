import sodium from "libsodium-wrappers-sumo";

export { CryptoError, isCryptoError, type CryptoErrorCode } from "./errors";
export {
  concatBytes,
  constantTimeEqual,
  fromBase64,
  toBase64,
  toHex,
  bytesToUtf8,
  utf8ToBytes,
} from "./encoding";
export {
  defaultKdfParams,
  deriveKeyFromPassphrase,
  generateKdfSalt,
  isKdfParamsWithinBounds,
} from "./kdf";
export { defaultKdfParams as kdfDefaults } from "./kdf";
export {
  createUserKeyMaterial,
  derivePublicKey,
  openPrivateKeyWithPassphrase,
  openPrivateKeyWithRecovery,
  sealPrivateKeyWithPassphrase,
  type UserKeyMaterial,
} from "./keys";
export {
  base32Decode,
  base32Encode,
  formatRecoveryKey,
  generateRecoveryKey,
  normalizeRecoveryKey,
  openPrivateKeyWithRecoveryKey,
  recoveryKeyHash,
  sealPrivateKeyWithRecoveryKey,
} from "./recovery";
export {
  generateProjectKey,
  unwrapProjectKey,
  wrapProjectKeyForMember,
} from "./wrap";
export {
  buildEnvAad,
  computeContentHash,
  openEnvFile,
  sealEnvFile,
  type EnvAadParts,
  type SealedEnvFile,
} from "./seal";

/** Resolves once libsodium's wasm is loaded. All functions await it internally; this is for preloading. */
export async function ready(): Promise<void> {
  await sodium.ready;
}
