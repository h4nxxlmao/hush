# Security model

hush.hanx.pro syncs `.env` files between machines and teammates. Everything is encrypted **on your machine** before it is uploaded, so the service only ever stores ciphertext. This document explains exactly what that means — including where it stops protecting you.

If you find a problem, please open an issue in the repository. Please do not test against other people's accounts.

---

## 1. What is encrypted, and with what

Only libsodium primitives are used. There are no home-made constructions.

| Purpose | Primitive |
|---|---|
| User identity | X25519 keypair (`crypto_box_keypair`) |
| Passphrase → key | Argon2id (`crypto_pwhash`, libsodium's *interactive* preset; the parameters are stored with the account so any device can re-derive) |
| Private key at rest | XSalsa20-Poly1305 secretbox (`crypto_secretbox_easy`), nonce prefixed to the blob |
| Recovery key | 32 random bytes, shown once as grouped base32; only its SHA-256 is stored (verification only) |
| Project key wrapping | Anonymous sealed boxes (`crypto_box_seal` / `crypto_box_seal_open`) |
| `.env` file encryption | XChaCha20-Poly1305 AEAD (`crypto_aead_xchacha20poly1305_ietf_*`) |
| Binding ciphertext to its slot | AAD = `projectId\|environmentName\|version\|keyVersion` |
| "Same content?" checks | Keyed BLAKE2b over the plaintext, under a subkey derived from the project key |
| CLI tokens / device codes / invite tokens | SHA-256 hashes at rest; raw values exist once, on the client |

The whole file is encrypted as one blob — **variable names included**. A ciphertext blob cannot be replayed into another environment, another version, or another key version without failing to decrypt on the client.

## 2. Key hierarchy

```
passphrase ──Argon2id(salt, params)──► KDF key ──secretbox──► encryptedPrivateKey   (stored server-side)
recovery key (32 random bytes)      ──secretbox──► encryptedPrivateKeyRecovery      (stored server-side)
private key (X25519) ──crypto_scalarmult_base──► publicKey                          (public, stored)
project key (32 random bytes, generated on `hush init`)
    └── crypto_box_seal(project key, member public key) ──► wrappedProjectKey       (stored per member)
            └── XChaCha20-Poly1305(project key, AAD) ──► ciphertext of each .env version
```

* The passphrase, the recovery key and both plaintext keys never leave your device.
* The server stores: `publicKey`, two sealed private-key copies, the KDF salt/params, one wrapped project key per member, and ciphertext.
* The KDF parameters are sanity-checked by the server (bounds only — it cannot and does not derive anything).

## 3. What the server can see, and what it can never see

**Sees (metadata):** project and environment names, version numbers and sizes, timestamps, who pushed what, your GitHub handle/avatar/email, IP addresses in the audit log, and the shape of your traffic.

**Never sees:** variable names, variable values, file contents, the project key, the unwrapped private key, the passphrase, the recovery key, or a raw CLI token (only its SHA-256).

## 4. Honest limits

* **A compromised server could serve malicious JavaScript.** The dashboard decrypts in the browser when you ask it to. That is opt-in and labelled as less secure than the CLI; the CLI is the recommended way to decrypt because no server-controlled code runs in the path between your key and your screen.
* **Metadata is metadata.** The server sees project/environment names and sizes. Don't put secrets in project, environment, or version message fields — the UI and CLI warn about this.
* **Revoked members keep what they already pulled.** Revoking rotates the project key and re-encrypts the latest version of every environment, so a revoked member cannot read anything pushed afterwards. Rotate the underlying secrets to genuinely cut them off.
* **Losing both the passphrase and the recovery key means the data is unrecoverable.** By design. Nobody at hush.hanx.pro can help.
* **Beta.** Don't store credentials you can't rotate.

## 5. Authentication and access control

* Web: Auth.js (NextAuth v5) with GitHub OAuth. JWT session cookie, `HttpOnly`, `Secure`, `SameSite=Lax`, `Domain=hush.hanx.pro` in production so the dashboard on `hush.hanx.pro` and the API on `api.hush.hanx.pro` share it.
* CLI: RFC 8628 device flow. Tokens are `hush_…`, stored as SHA-256, shown once, revocable, with `lastUsedAt` tracking. Constant-time comparisons are used where values are compared.
* Every API route re-checks membership and role against the database. Projects you cannot access return **404**, not 403, so project existence never leaks.
* Browser mutations must carry `X-Hush-Client: web` **and** come from an allowlisted `Origin` (CORS + CSRF defense in depth). Bearer-token clients are exempt.
* Rate limits: 10 device attempts/min/IP, 60 API calls/min/token, 20 pushes/min/project, 120 browser mutations/min/IP. Production uses Upstash Redis; the in-memory fallback is development-only and says so.
* Limits: 1 MB ciphertext per version, 10 environments per project, 5 projects per user, 5 memberships per user (free tier), 50 versions kept per environment.

## 6. Server-side hygiene

* The backend never imports the crypto package (enforced by ESLint) and has no code path that could decrypt anything.
* Request bodies are never logged. Structured JSON logs contain method, path, status, duration and ids — no headers, tokens, ciphertext or secrets.
* Ciphertext lives in Postgres (Neon) over the serverless driver; devices, rate limits and temporary state live in Postgres/Redis because serverless instances hold nothing between requests.
* Security headers on both apps: CSP with a per-request nonce (no `unsafe-inline` for scripts), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy`.
* Preview deployments read CORS/cookie settings from the environment so no code changes are needed.

## 7. Verify it yourself

```bash
pnpm --filter @hush/crypto test     # known-answer, tamper, AAD-mismatch, wrong-key tests
pnpm --filter backend test           # includes a test that dumps every table and asserts
                                     # the plaintext secret value/name appears nowhere
pnpm --filter @xnah/hush test             # parser and diff edge cases
pnpm --filter @xnah/hush test:e2e         # the real CLI against a live backend
```

The backend test suite is the strongest evidence for the core claim: it pushes a file containing a known secret, then serialises **every row of every table** and asserts the plaintext value and the variable name do not occur anywhere.
