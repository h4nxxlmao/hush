# @hush/crypto

Client-side cryptography for hush.hanx.pro. Used by the CLI and by the browser dashboard (web unlock), so both decrypt with byte-for-byte identical logic.

**libsodium only.** No homemade constructions, no custom primitives. Every function here maps to a documented libsodium primitive.

## Primitives in use

| Purpose | Primitive |
|---|---|
| User identity | X25519 keypair (`crypto_box_keypair`) |
| Passphrase KDF | Argon2id (`crypto_pwhash`, `crypto_pwhash_ALG_ARGON2ID13`) |
| Private key at rest | XSalsa20-Poly1305 secretbox (`crypto_secretbox_easy`), nonce prefixed to the blob |
| Recovery key | 32 random bytes (`randombytes_buf`) shown as grouped RFC 4648 base32, SHA-256 hash stored for verification |
| Project key wrapping | Anonymous sealed boxes (`crypto_box_seal` / `crypto_box_seal_open`) |
| Env file encryption | XChaCha20-Poly1305 AEAD (`crypto_aead_xchacha20poly1305_ietf_encrypt`) with AAD `projectId\|environment\|version\|keyVersion` |
| Content fingerprint | Keyed BLAKE2b (`crypto_generichash` with a subkey derived from the project key) |

## Modules

| File | Responsibility |
|---|---|
| `src/kdf.ts` | Salt generation, Argon2id derivation, KDF parameter defaults/bounds |
| `src/keys.ts` | User keypair creation, private-key sealing/opening (passphrase) |
| `src/recovery.ts` | Recovery key generation/formatting/normalization, recovery-based private-key opening |
| `src/wrap.ts` | Project key generation, `crypto_box_seal` wrapping for members, unwrapping |
| `src/seal.ts` | Env file sealing/opening, AAD construction, content hash |
| `src/encoding.ts` | base64/base32/hex/UTF-8 helpers over libsodium |
| `src/errors.ts` | `CryptoError` with machine-readable codes and human messages |

## How to run it alone

```bash
pnpm --filter @hush/crypto test        # includes known-answer and tamper tests
pnpm --filter @hush/crypto typecheck
pnpm --filter @hush/crypto build
```

## Env vars

None. This package never touches the network, the filesystem, or `process.env`.

## Memory hygiene

Key material is zeroed with `sodium.memzero` after use where practical. Nothing in this package logs. Callers must never log plaintext, keys, passphrases, or tokens.
