# Changelog

All notable changes to `@xnah/hush` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [0.1.0] - 2026-10-19

First public beta. The CLI is feature complete against the hosted API.

### Added

- `hush login` and `hush logout`: RFC 8628 device flow, GitHub sign-in, token stored in the OS keychain (macOS Keychain, Windows Credential Manager, secret-service) with a `0600` file fallback.
- `hush init`: create a project with a locally generated project key, or link the current folder to an existing one through `.hush.json`.
- `hush push` / `hush pull` / `hush rollback`: versioned uploads and downloads, optimistic concurrency with a 409 that reports both version numbers, masked diffs before overwriting a changed local file.
- `hush diff` and `hush check`: compare with a remote version, or verify that every variable from `.env.example` exists; `check` exits 1 so it works in CI and pre-commit hooks.
- `hush run`: inject an environment into a child process without writing a file, forwarding signals and the exit code.
- `hush ls`, `hush history`, `hush members`: project, environment and version inventory.
- `hush invite` / `hush revoke` with client-side key rotation: a revoked member gets a new project key, every environment is re-encrypted and every remaining member is re-wrapped, all before the request leaves the machine.
- `hush key export` / `hush key import`, `hush lock` / `hush unlock`: move a sealed identity key between machines, or clear the cached key.
- `hush doctor`: API reachability, token validity, keychain backend, key setup, `.gitignore` coverage, file permissions and the linked project.
- `hush completion bash|zsh|fish`.
- Global flags: `--json`, `--api-url`, `--no-color`, `-y/--yes`, `-e/--env`. Exit codes: `0` success, `1` error, `2` usage, `3` auth, `4` conflict.

### Security

- libsodium only: X25519 identity keypair, Argon2id passphrase KDF (interactive preset), secretbox for the private key at rest, `crypto_box_seal` for project key wrapping, XChaCha20-Poly1305 for whole-file encryption with AAD `projectId|environment|version|keyVersion`.
- A one-time base32 recovery key; only its SHA-256 is stored server side.
- Variable names are encrypted with the values, so the server sees no names, no values and no keys.
- Remember the beta caveat: do not store credentials you cannot rotate.
