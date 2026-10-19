# hush

[![CI](https://github.com/h4nxxlmao/hush/actions/workflows/ci.yml/badge.svg)](https://github.com/h4nxxlmao/hush/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@xnah/hush.svg)](https://www.npmjs.com/package/@xnah/hush)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](./package.json)

**Your .env, everywhere. Encrypted before it leaves your machine.**

`hush` is a zero-knowledge `.env` sync CLI. Push and pull `.env` files across machines and teammates, everything is encrypted on your machine, so the server only ever stores ciphertext. Diff versions, check for missing variables, inject variables into a command without writing a file, and roll back.

> **Beta. Don't store credentials you can't rotate.**

- Website and dashboard: [hush.hanx.pro](https://hush.hanx.pro)
- Package: `@xnah/hush` (binary `hush`)

```bash
npm i -g @xnah/hush
hush login
hush init
hush push -e dev
```

## How it works

Encryption happens locally, with libsodium only:

| Purpose | Primitive |
|---|---|
| Identity | X25519 keypair (`crypto_box_keypair`) |
| Passphrase → key | Argon2id (`crypto_pwhash`, interactive preset) |
| Private key at rest | XSalsa20-Poly1305 secretbox, nonce prefixed |
| Recovery key | 32 random bytes shown once as grouped base32; only its SHA-256 is stored |
| Project key wrapping | Anonymous sealed boxes (`crypto_box_seal`) |
| `.env` file encryption | XChaCha20-Poly1305 AEAD, AAD `projectId\|environment\|version\|keyVersion` |

The whole file is one blob, so **variable names are encrypted too**. Ciphertext cannot be moved between environments or versions without decryption failing loudly on the client. The server sees project and environment names, sizes, timestamps and who pushed, never a name, a value, a key or a passphrase. The honest limits (including what a compromised server could do) are in [SECURITY.md](./SECURITY.md).

## Commands

| Command | What it does |
|---|---|
| `hush login` | Device flow (approve a code in the browser) plus first-run key setup: passphrase, recovery key shown once |
| `hush logout` | Revoke this device's token and clear cached keys |
| `hush whoami` | User, device, keychain and key status |
| `hush init` | Create a project (generating the project key locally) or link this folder to an existing one |
| `hush push [file] -e <env> -m "msg"` | Encrypt and upload as a new version. Stale base version → 409 with both numbers; `--force` re-reads and pushes |
| `hush pull -e <env> [-o file]` | Fetch, decrypt and write. A differing local file shows a masked diff and asks first (`--force` skips) |
| `hush diff -e <env> [--version N] [--reveal]` | Compare your file with a remote version; values masked as `••••••••` unless revealed |
| `hush check [--example .env.example] [--remote -e dev]` | Missing/extra variables; exits 1 when something required is missing (CI and pre-commit friendly) |
| `hush run -e <env> -- <command>` | Inject variables into a child process without writing a file; forwards signals and the exit code |
| `hush ls` | Projects and environments with version, last push and size |
| `hush history -e <env>` | Version list: number, author, time, size, message |
| `hush rollback -e <env> <version>` | Re-encrypt an old version's content as a new version (history keeps both) |
| `hush invite <github-username> [--role member]` | Wrap the project key for the invitee and send the invite |
| `hush members` | Members, roles and pending invites |
| `hush revoke <github-username>` | Revoke and rotate: new project key, every environment re-encrypted, everyone else re-wrapped, all client-side |
| `hush key export` / `key import` | Move your sealed key between machines (the export is ciphertext; useless without your passphrase) |
| `hush lock` / `unlock` | Clear or restore the cached private key |
| `hush doctor` | API reachability, token validity, keychain, key setup, `.gitignore`, file permissions, linked project |
| `hush completion bash\|zsh\|fish` | Shell completions |

Global flags: `--json`, `--api-url`, `--no-color`, `-y/--yes`, `-e/--env`.
Exit codes: `0` success, `1` general error, `2` usage, `3` auth, `4` conflict.

## Where state lives

- CLI token and decrypted private key cache: OS keychain (macOS Keychain, Windows Credential Manager, secret-service), with a `0600` file fallback under `~/.config/hush` and a warning when it is used.
- Project link: `.hush.json` in the repo (project id, slug, default environment, no secrets; commit it so teammates link instantly).
- Scripts and CI overrides: `HUSH_API_URL`, `HUSH_STATE_DIR`, `HUSH_KEYCHAIN=file`, `HUSH_TOKEN`.

## Layout

```
src/            commands, API client, keychain, dotenv handling, UI
tests/          unit tests + an end-to-end suite that runs the built binary
shared/schemas  the API contract (Zod), shared with the server and the dashboard
shared/crypto   the libsodium primitives (identical code runs in the browser)
```

`shared/` is a verbatim copy of the packages used by the service, vendored so this repository builds standalone. The canonical sources live in the service monorepo; when the crypto or the API contract changes, this copy is updated with it. Keeping one implementation is deliberate: the CLI and the browser must decrypt byte-for-byte identically.

## Development

```bash
pnpm install
pnpm build          # tsup bundle -> dist/index.js (self-contained, ~1.4 MB)
pnpm test           # unit tests (parsing, diffs, gitignore)
pnpm test:e2e       # the built binary against a live backend on http://localhost:4000
pnpm typecheck
node dist/index.js --help
```

The published artifact bundles `@hush/schemas`, `@hush/crypto` and libsodium, so the only runtime dependencies are small helpers (`citty`, `@clack/prompts`, `picocolors`, `dotenv`, `open`) plus `@napi-rs/keyring` for the native keychain.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first: it covers the local setup, the test suites, the rules for crypto changes and how releases are cut. Bug reports have a template that asks for the version, OS and a redacted log.

If you find a vulnerability, please use the [security policy](https://github.com/h4nxxlmao/hush/security/policy) instead of a public issue.

## Security

Please read [SECURITY.md](./SECURITY.md) before relying on this for anything sensitive. Report problems by opening an issue; do not test against other people's accounts.

## License

[MIT](./LICENSE)
