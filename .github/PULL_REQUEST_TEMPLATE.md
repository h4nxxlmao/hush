## What changed

<!-- One paragraph. Link the issue if there is one: Closes #123 -->

## Type of change

- [ ] Bug fix (no behaviour change beyond the fix)
- [ ] New command, flag or option
- [ ] Cryptography or stored format (requires new test vectors, see below)
- [ ] Documentation or copy
- [ ] Refactor or internal cleanup
- [ ] CI, tooling or release

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] New behaviour has a test, or the PR explains why not
- [ ] No secrets, passphrases, tokens or decrypted `.env` values in code, fixtures, logs or screenshots
- [ ] Docs updated if a command, flag or exit code changed
- [ ] For crypto or storage changes: the AAD format, key derivation and wire format are unchanged, or the change includes golden test vectors and a migration note

## How I tested it

<!-- The exact commands you ran, and what you saw. `hush doctor` output helps. -->

## Notes for reviewers

<!-- Trade-offs, open questions, anything you want a second opinion on. -->
