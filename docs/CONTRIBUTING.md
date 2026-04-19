# Contributing

> [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) · **Contributing** · [Releasing](RELEASING.md)

Thank you for your interest in contributing to zefer-cli. Please read the [Code of Conduct](../CODE_OF_CONDUCT.md) before participating.

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
git clone https://github.com/carrilloapps/zefer-cli.git
cd zefer-cli
npm install
```

### Development

```bash
npm run dev          # Run with tsx (no build step needed)
npm run build        # Compile to dist/
npm run typecheck    # TypeScript strict check (no errors expected)
```

### Test your changes

```bash
# Build
npm run build

# Encrypt a file
node dist/index.js encrypt <your-file> -p testpass

# Decrypt it back
node dist/index.js decrypt <your-file>.zefer -p testpass --force

# Verify output matches the original
```

## Project Structure

```
src/
  commands/       # One file per CLI command (Ink React components)
  lib/            # Core crypto libraries (Node.js ports of zefer/app/lib/)
  ui/             # Reusable Ink components (Header, ProgressBar, Spinner, StatusLine)
  utils/          # Shared utilities (format, prompt, terminal detection)
  index.ts        # CLI entry point (Commander setup)
```

## Conventions

### TypeScript

- Strict mode — no `any`, no `as` casts without a comment explaining why
- Async functions for all I/O and crypto operations
- `Buffer` (not `Uint8Array`) for binary data at the boundary between Node.js and the zefer format
- `>>> 0` after bitwise XOR operations that may produce signed results

### Ink components

- Each command (`encrypt`, `decrypt`, `keygen`, `info`) is a React component exported as `XxxApp`
- Props are typed with an `XxxOptions` interface in the same file
- All side effects run in a single `useEffect` on mount
- Call `useApp().exit()` (with a delay) when the operation completes
- Use `StatusLine` for the standard spinner + progress bar UI

### Terminal output

- Never use hard-coded Unicode characters — use `src/utils/terminal.ts` exports (`ICON_OK`, `BAR_FILLED`, etc.)
- Colors via Ink's `<Text color="...">` — never via chalk in React components
- chalk is only used for non-Ink output (if any)

### Cross-platform

- Test password prompts with and without a TTY (pipe a passphrase via stdin)
- Verify `ZEFER_ASCII=1` produces sensible output
- File paths: use `path.join` / `path.basename`, never string concatenation

### Binary format compatibility

The `.zefer` binary format is shared with the web app. **Do not change the format** without also updating [zefer](https://github.com/carrilloapps/zefer) and incrementing the magic bytes (e.g., `ZEFB4`). Cross-compatibility is a hard requirement.

## Making Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run `npm run typecheck` — zero errors required
5. Run `npm run build` — must succeed
6. Test manually: encrypt a file, decrypt it, verify the output
7. Submit a pull request with a clear description

## Adding a New Command

1. Create `src/commands/<name>.tsx` with an `XxxApp` component and `XxxOptions` interface
2. Wire it in `src/index.ts` using Commander's `.command()` API
3. Export it from the command file
4. Add it to the README command reference

## Adding a New Security Option

Security options always live inside the **encrypted payload** (`ZeferMeta`), never in the public header (`ZeferHeader`). To add a new option:

1. Add the field to `ZeferMeta` in `src/lib/zefer.ts`
2. Add it to `EncodeOptions` and `encodeZefer()`
3. Add the post-decryption check in `decodeZefer()`
4. Add the CLI flag in `src/index.ts`
5. Add it to `src/commands/encrypt.tsx` props and `--verbose` display
6. Update `docs/ARCHITECTURE.md` and `README.md`
7. If it's also a new format version, update the web app at the same time

## Adding a New Keygen Mode

1. Add the mode to `KeygenMode` union in `src/lib/keygen.ts`
2. Add a case to the `switch` in `generateKey()`
3. Add it to the `--mode` option description in `src/index.ts`
4. Update the README keygen modes table

## Releasing a New Version

Publishing is automated via GitHub Actions. See the full process in [docs/RELEASING.md](RELEASING.md).

**Quick summary:**
1. `npm version patch|minor|major`
2. Update `CHANGELOG.md`, then `git commit --amend --no-edit`
3. `git push origin main --tags`
4. `gh release create v<version> --generate-notes`
5. GitHub Actions publishes to npm automatically

## Security Contributions

If your change touches cryptographic code (`src/lib/crypto.ts`, `src/lib/chunked-crypto.ts`, `src/lib/zefer.ts`):

- Verify byte-for-byte compatibility with the web app by encrypting with the CLI and decrypting in the browser (and vice versa)
- Do not change iteration counts, salt lengths, IV lengths, or auth tag handling without a documented reason
- If you find a security issue, please follow the [Security Policy](../SECURITY.md) instead of opening a public PR

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
