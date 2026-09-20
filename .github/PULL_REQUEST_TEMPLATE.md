## Description

<!-- What does this PR do? -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] CI/CD

## Affected Channels

<!-- zefer-cli ships three channels over one shared core (src/lib/*). -->

- [ ] CLI (`src/index.ts`, `src/commands/**`)
- [ ] MCP server (`src/mcp/server.ts`)
- [ ] Library (`src/lib.ts`, the published `exports["."]`)
- [ ] Shared core (`src/lib/**`) — **affects all three**

## Checklist

### Quality Gates

- [ ] `npm run lint` passes (zero errors, zero warnings)
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run test:coverage` passes — 100% statements, branches, functions and lines
- [ ] `npm run test:integration` passes — the 96 cross-channel checks
- [ ] `npm run build` produces both the CLI/MCP bundle and the ESM + CJS library
- [ ] `npm run verify` passes end to end
- [ ] No scanner finding was silenced with an inline suppression or a lowered threshold

### Binary Format & Crypto

- [ ] No change to the magic bytes, salt length (32 B), base IV length (12 B), chunk size (16 MB) or auth tag size (16 B)
- [ ] If the format or crypto layer changed, the [web app](https://github.com/carrilloapps/zefer) ships the same change in the same release
- [ ] A file encrypted here decrypts in the browser, and vice versa
- [ ] Security metadata stays inside the encrypted payload (`ZeferMeta`), never in the public header

### Conventions

- [ ] No hardcoded Unicode characters — they come from `src/utils/terminal.ts`
- [ ] All paths built from the decrypted payload go through `src/utils/paths.ts`
- [ ] PBKDF2 uses the async `crypto.pbkdf2`, never `pbkdf2Sync`
- [ ] Tested with and without a TTY, and with `ZEFER_ASCII=1`

### Documentation

- [ ] `README.md` updated (new command, flag, keygen mode or library export)
- [ ] `docs/ARCHITECTURE.md` / `docs/SECURITY.md` / `docs/LIBRARY.md` / `docs/MCP.md` updated where relevant
- [ ] `CHANGELOG.md` entry added under the correct Keep a Changelog heading
