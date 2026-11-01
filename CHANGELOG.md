# Changelog

All notable changes to `@xnah/hush` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/).

## [0.2.1] - 2026-11-01

Source-only security pass focused on the child-process boundary, local file reads and the leave/rotation lifecycle.

### Security

- `hush run` now strips `HUSH_*` from the remote env as well as the inherited one. The previous filter ran before the merge, so a pushed `HUSH_STATE_DIR`, `HUSH_KEYCHAIN` or `HUSH_TOKEN` could reach the child. Proxy, TLS, module-loader and package-manager variables are blocked too.
- `push`, `diff`, `check` and `example` refuse a symlinked env file whose target is outside the working directory, so a committed `.env` symlink cannot upload or read `~/.ssh/id_rsa`.
- `writeFileNoFollow` cleans up its secret-bearing temp file when chmod or rename fails; the legacy state migration reapplies 0600 to moved key/token files.
- `example` refuses to overwrite its own source `.env` and preserves an existing output file's mode.
- `leave` removes legacy `.envhx.json` links and now says that the decrypted `.env` and key cache remain.
- `push --dry-run` no longer caches the decrypted private key; `diff --version` validates the value before making a request; `use` requires `--relink` before moving a folder to another project.

### Changed

- `revoke` is owner-only on the server. Admins still invite and change roles, but cannot replace the owner's wrapped project key.
- `leave` is a membership change, not a key rotation. The owner must revoke a departed member if the key needs to rotate.

## [0.2.0] - 2026-10-22

Quality-of-life pass plus the security hardening from the full source audit.

### Added

- `hush use [env]`: pin the default environment for the current folder in `.hush.json`, or list environments and mark the current one.
- `hush example`: generate a `.env.example` from a real `.env` with every value blanked and key order preserved; `--force` overwrites and `-o` picks the output.
- `hush leave`: leave a project as a non-owner, with a confirmation unless `-y`; the folder link is removed when it points at that project.
- `hush push --dry-run`: show the next version and change summary without encrypting or uploading.
- `hush diff --exit-code`: exit 1 when the local file and remote version differ, for CI.
- `hush run --only A,B`, `--except A,B` and `--no-inherit`: inject exactly the variables a child process needs and optionally start from an empty environment.

### Security

- Secret writes are atomic, refuse symlinks, and enforce `0600`; `pull` tightens existing files.
- `key export` defaults outside the repository and `key import` verifies that the imported key matches its public key.
- `run` strips `HUSH_*` and execution-affecting variables such as `NODE_OPTIONS` from the child.
- API URL overrides must be HTTPS or localhost; logout fails loudly instead of silently doing nothing.
- The AEAD additionally binds the requested environment and version to the response, so a blob cannot be replayed into another environment.

### Changed

- Relicensed from MIT to GPL-3.0-only. Releases already published under MIT keep that license; this and future releases are GPLv3.
- The `.env.example` check now documents the real exit code (`1`), not `4`.
- Shell completions and docs cover the new commands and flags.

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
