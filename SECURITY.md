# Security model

hush.hanx.pro syncs `.env` files between machines and teammates. Everything is encrypted **on your machine** before it is uploaded, so the service only ever stores ciphertext. This document explains exactly what that means, including where it stops protecting you.

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

The whole file is encrypted as one blob, **variable names included**. A ciphertext blob cannot be replayed into another environment, another version, or another key version without failing to decrypt on the client.

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
* The KDF parameters are sanity-checked by the server (bounds only, it cannot and does not derive anything).

## 3. What the server can see, and what it can never see

**Sees (metadata):** project and environment names, version numbers and sizes, timestamps, who pushed what, your GitHub handle/avatar/email, IP addresses in the audit log, and the shape of your traffic.

**Never sees:** variable names, variable values, file contents, the project key, the unwrapped private key, the passphrase, the recovery key, or a raw CLI token (only its SHA-256).

## 4. Honest limits

* **A compromised server could serve malicious JavaScript.** The dashboard decrypts in the browser when you ask it to. That is opt-in and labelled as less secure than the CLI; the CLI is the recommended way to decrypt because no server-controlled code runs in the path between your key and your screen.
* **Metadata is metadata.** The server sees project/environment names and sizes. Don't put secrets in project, environment, or version message fields, the UI and CLI warn about this.
* **Revoked members keep what they already pulled.** Only the project owner can revoke a member. Revocation rotates the project key and re-encrypts the latest version of every environment with content, so a revoked member cannot read anything pushed afterwards. A member who leaves on their own does not trigger a rotation: they keep the key for everything already on their machine, and the owner must revoke them or rotate the key if that matters. Rotate the underlying secrets to genuinely cut them off.
* **Losing both the passphrase and the recovery key means the data is unrecoverable.** By design. Nobody at hush.hanx.pro can help.
* **Beta.** Don't store credentials you can't rotate.

## 5. Authentication and access control

* Web: GitHub OAuth. The session is an opaque random token, stored server side as a SHA-256 hash, sent in a `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to the site domain so the dashboard and the API share one sign-in.
* CLI: RFC 8628 device flow. Tokens are `hush_…`, stored as SHA-256, shown once, revocable, with `lastUsedAt` tracking. Constant-time comparisons are used where values are compared.
* Every API route re-checks membership and role against the database. Projects you cannot access return **404**, not 403, so project existence never leaks.
* Browser mutations must carry `X-Hush-Client: web` **and** come from an allowlisted `Origin` (CORS + CSRF defense in depth). Bearer-token clients are exempt.
* Mutating request bodies must be `application/json`; anything else is rejected before parsing, so a cross-origin form post cannot smuggle a body past the CSRF check.
* The OAuth state is compared in constant time, and post-sign-in `?next=` redirects accept only same-site paths (no backslashes, control characters or protocol-relative URLs).
* Device-code lookups validate the `ABCD-EFGH` format and share the login limiter, so an authenticated session cannot enumerate codes.
* Rate limits: 10 device attempts/min/IP, 60 API calls/min/token, 20 pushes/min/project, 120 browser requests/min/account (reads and mutations), enforced with the Cloudflare Workers rate limiting bindings. The in-memory fallback is bounded to 10,000 keys and evicts the oldest.
* Deployment configuration fails closed: `DEV_LOGIN`/`DEV_BOOTSTRAP` are rejected unless `WEB_ORIGIN` is localhost, and a non-local deployment requires a `SESSION_SECRET` of at least 32 characters. `Secure` cookies are derived from an `https://` origin, not from whether a cookie domain was set.
* The account public key is immutable through `PUT /api/me/keys`: a passphrase or recovery-key change re-seals the same private key and cannot silently redirect future project-key wraps to a new key.
* Audit-log IP addresses are returned only to project admins/owners; device approval shows a masked IP.
* Limits: 1 MB ciphertext per version, 10 environments per project, 5 projects per user, 5 memberships per user (free tier), 50 versions kept per environment, trimmed for every environment.

## 6. Server-side hygiene

* The backend never imports the crypto package (enforced by ESLint) and has no code path that could decrypt anything.
* Request bodies are never logged. Structured JSON logs contain method, path, status, duration and ids, no headers, tokens, ciphertext or secrets.
* Ciphertext, device codes, invites and sessions live in Cloudflare D1 (SQLite). The Worker holds no state between requests; a daily cron job and opportunistic cleanup remove expired rows and trim old versions.
* Security headers on both apps: CSP with a per-request nonce on the request and the response (so Next can stamp its own scripts), `'wasm-unsafe-eval'` for the libsodium WebAssembly build, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `X-DNS-Prefetch-Control`, `Permissions-Policy`. The only third-party origin the site's CSP allows is `avatars.githubusercontent.com`, for GitHub profile images.
* Deployments read CORS and cookie settings from the environment, so the same build works in development and production.

## 7. Verify it yourself

```bash
pnpm --filter "./shared/*" test     # known-answer, tamper, AAD-mismatch and wrong-key tests
pnpm test                           # parser and diff edge cases
pnpm test:e2e                       # the built CLI against a live backend
```

The service test suite is the strongest evidence for the core claim: it pushes a file containing a known secret, then serialises **every row of every table** and asserts the plaintext value and the variable name do not occur anywhere.
