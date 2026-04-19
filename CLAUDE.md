# zefer-cli — Claude Code Context

This file provides context for Claude Code when working in this repository.

## What this project is

zefer-cli is the official CLI companion to [zefer.carrillo.app](https://zefer.carrillo.app) ([repo](https://github.com/carrilloapps/zefer)). It encrypts and decrypts `.zefer` files using AES-256-GCM with PBKDF2-SHA256, 100% locally.

The web app lives at `/home/carrilloapps/Desarrollo/Nextjs/zefer` (locally). Files produced by this CLI are byte-for-byte compatible with the web app.

## Tech stack

- **Runtime**: Node.js 20+ (ESM)
- **CLI UI**: Ink 5 (React 18 for the terminal)
- **Argument parsing**: Commander 12
- **Language**: TypeScript 5 (strict mode)
- **Crypto**: Node.js `crypto` module (AES-256-GCM, PBKDF2)
- **Compression**: Node.js `zlib`
- **Build**: tsup → `dist/index.js` (50 KB ESM bundle with shebang)

## Key files

```
src/index.ts                  — Commander setup, all command wiring
src/lib/crypto.ts             — AES-256-GCM + PBKDF2 (Node.js port)
src/lib/chunked-crypto.ts     — 16 MB chunked encryption (Node.js port)
src/lib/compression.ts        — gzip/deflate via zlib (Node.js port)
src/lib/zefer.ts              — ZEFB3/ZEFR3 encode/decode (Node.js port)
src/lib/progress.ts           — Progress stage tracking
src/lib/keygen.ts             — CSPRNG key generation, 5 modes
src/lib/attempts.ts           — ~/.zefer/attempts.json (replaces localStorage)
src/utils/terminal.ts         — Unicode/ASCII capability detection
src/utils/prompt.ts           — Cross-platform password input
src/commands/encrypt.tsx      — Ink UI for encrypt command
src/commands/decrypt.tsx      — Ink UI for decrypt command
src/commands/keygen.tsx       — Ink UI for keygen command
src/commands/info.tsx         — Ink UI for info command
```

## Build and run

```bash
npm run build        # tsup → dist/index.js
npm run dev          # tsx src/index.ts (no build step)
npm run typecheck    # tsc --noEmit (should have 0 errors)

node dist/index.js --help
node dist/index.js keygen
node dist/index.js encrypt <file> -p <pass>
node dist/index.js decrypt <file>.zefer -p <pass>
node dist/index.js info <file>.zefer
```

## Critical invariants

### Binary format compatibility
The `.zefer` format is shared with the web app. Never change:
- Magic bytes (`ZEFB3`, `ZEFR3`)
- Salt length (32 bytes)
- Base IV length (12 bytes)
- Chunk size (16 MB = `16 * 1024 * 1024`)
- Auth tag size (16 bytes, appended to ciphertext)
- Header field names or types
- `ZeferMeta` field names or types

### Chunk IV derivation
```typescript
// Last 4 bytes of baseIv XOR'd with chunk index
// MUST use >>> 0 — JS bitwise XOR returns signed int for values >= 2^31
iv.writeUInt32BE((current ^ index) >>> 0, 8);
```

### Dual key separator
```typescript
// Exact separator — must match the web app
combineDualKeys(p1, p2) = `${p1}\x00ZEFER_DUAL\x00${p2}`
```

### PBKDF2 async
Use `crypto.pbkdf2` (promisified), never `crypto.pbkdf2Sync`. The sync version blocks the event loop and freezes the Ink UI.

## Terminal / cross-platform rules

- All Unicode characters (spinner frames, progress blocks, icons) must come from `src/utils/terminal.ts`
- Never hardcode `█`, `░`, `⠋`, `▸`, `─`, `✓`, `✗` in source files
- Password input must always be hidden — see the three strategies in `src/utils/prompt.ts`
- Use `path.join` and `path.basename` for all path operations

## Ink patterns

```typescript
// Standard command component
export function FooApp(opts: FooOptions) {
  const { exit } = useApp();
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      try {
        // ... do work, call setProgress(...)
        setDone(true);
        setTimeout(() => exit(), 100); // small delay so final render shows
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setTimeout(() => exit(new Error(...)), 100);
      }
    }
    run();
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header title="zefer foo" />
      <StatusLine progress={progress} done={done} error={error} />
    </Box>
  );
}
```

## Common mistakes to avoid

1. Calling `crypto.pbkdf2Sync` — use the async version
2. Hardcoding Unicode characters — use `terminal.ts` exports
3. Changing the binary format without updating the web app
4. Forgetting `>>> 0` after bitwise XOR in `chunkIv`
5. Using `setRawMode` without checking if it exists — it's not available in all terminals
6. Writing to stdout before Ink exits — use `globalThis.__zefer_stdout_content` pattern for text-mode decrypt
7. Forgetting `--force` check before `fs.writeFileSync` to avoid silently overwriting files

## CI / CD

Two GitHub Actions workflows:

| File | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | Push / PR to `main` | Typecheck + build + 26 smoke tests on Node 20 & 22 |
| `.github/workflows/binaries.yml` | GitHub Release published | Builds and uploads standalone binaries for all platforms |

**To release:**
1. `npm version patch|minor|major` — bumps `package.json`, commits, tags, auto-pushes
2. Update `CHANGELOG.md` + `git commit --amend --no-edit`
3. `npm publish --otp=XXXXXX` — publish to npm manually (no CI token needed)
4. `npm run release:gh` — creates GitHub Release → triggers binary builds automatically

## Related project

The web app at `/home/carrilloapps/Desarrollo/Nextjs/zefer` (GitHub: `carrilloapps/zefer`, live: `zefer.carrillo.app`) is the canonical reference for:
- Binary format specification
- Cryptographic parameters
- Security metadata schema (`ZeferMeta`)
- Feature parity

**Cross-compatibility rule**: always verify that a file encrypted by the CLI decrypts in the browser, and vice versa, before merging any change to the crypto or format layer.
