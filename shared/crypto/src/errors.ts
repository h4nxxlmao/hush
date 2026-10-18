export type CryptoErrorCode =
  | "invalid_input"
  | "decrypt_failed"
  | "invalid_key"
  | "invalid_recovery_key"
  | "not_ready";

/**
 * All failures from this package surface as CryptoError with a code a caller can
 * switch on and a message that is safe to show a user. Messages never include key
 * material, plaintext, or passphrases.
 */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = "CryptoError";
    this.code = code;
  }
}

export function isCryptoError(error: unknown): error is CryptoError {
  return error instanceof CryptoError;
}
