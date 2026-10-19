# Contributing to hush

Thanks for taking a look. This is a small project with one hard rule: the server never sees plaintext, and no change may weaken that.

## Requirements

- Node 22.13 or newer for development (pnpm 11 needs it). CI runs Node 22 and 24.
- pnpm 11 (`corepack enable` picks up the version pinned in `package.json`)

The published CLI itself runs on Node 20 and newer; only the development toolchain requires 22.13.

## Setup

```bash
git clone https://github.com/h4nxxlmao/hush.git
cd hush
pnpm install
pnpm build
node dist/index.js --help
```

`shared/schemas` and `shared/crypto` are part of this workspace, so `pnpm install` links them automatically. They are vendored copies of the service packages, kept here so the CLI builds standalone.

## Scripts

| Command | What it does |
|---|---|
| `pnpm build` | bundle `src/` into `dist/index.js` with tsup |
| `pnpm dev` | rebuild on change |
| `pnpm test` | unit tests (dotenv parsing, diffs, masking, gitignore) |
| `pnpm --filter "./shared/*" test` | crypto and schema tests |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint (flat config) |
| `pnpm test:e2e` | the built binary against a live API on `http://localhost:4000` |

The end-to-end suite needs a running backend. The service is a Cloudflare Worker; see the [API repository](https://github.com/h4nxxlmao/hush.hanx.pro) for `wrangler dev`. It signs in through a development route, so it never touches real credentials.

## Layout

```
src/commands/     one file per command, citty definitions only
src/lib/          API client, keychain, state, dotenv parsing, diffs, UI
tests/            unit tests and the end-to-end suite
shared/schemas/   the API contract: Zod schemas, types, constants
shared/crypto/    libsodium primitives used by the CLI and the browser
```

Rules of thumb:

- Commands stay thin. Business logic lives in `src/lib/` and is testable without a TTY.
- The CLI never imports frontend or backend code. It talks HTTP and nothing else.
- Crypto changes are the exception to every shortcut: add golden test vectors (a fixed passphrase, salt, nonce and plaintext with the expected output), keep the AAD `projectId|environment|version|keyVersion` and the key derivation stable, and state in the PR why the format cannot stay as it is.
- Anything the user sees should be readable in a terminal: short lines, no colour when `NO_COLOR` is set, `--json` for machines.

## Style

- TypeScript strict, 2 spaces, double quotes, semicolons, 100 column soft limit.
- Comments explain why, not what. No commented-out code.
- Prose and terminal copy use plain punctuation: commas, colons, parentheses. No em dashes.

## Commits and pull requests

- Commits are imperative and scoped: `feat(check): exit 1 when a required variable is missing`, `fix(pull): keep the file mode on Windows`. Say why in the body when it is not obvious.
- Keep pull requests small. One behaviour per PR, with the test that proves it.
- Fill in the pull request template, including the exact commands you ran.
- CI must be green on Node 20 and 22. Reviews look at behaviour first, then tests, then style.

## Reporting bugs and security issues

- Bugs: open an issue with the template. Redact secrets, tokens and decrypted values.
- Vulnerabilities: do **not** open a public issue. Use the [security policy](https://github.com/h4nxxlmao/hush/security/policy) so the fix can ship before the details do.

## Releases

Maintainers only. Bump the version in `package.json`, add the entry to `CHANGELOG.md`, commit, then push a tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The release workflow packs the workspace (`pnpm pack` rewrites `workspace:*` to real versions) and publishes to npm with provenance. That requires an `NPM_TOKEN` repository secret; without it the workflow skips publishing with a warning. Then create the GitHub release from the tag so the notes appear on the repository and on the website.
