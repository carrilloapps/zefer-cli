# Releasing

> [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · **Releasing**

This document covers the complete release process for zefer-cli, including the one-time GitHub Actions setup.

---

## Publishing to npm

npm publishing is done manually from the terminal — no GitHub Actions token required.

```bash
npm publish --otp=XXXXXX   # enter the 6-digit code from your authenticator
```

The `prepublishOnly` script runs `typecheck + build + verify` automatically before publishing.

---

## Publishing a new version

Once the secret is set, every GitHub Release triggers an automatic publish.

### Step 1 — Bump the version

```bash
# Patch: 1.0.0 → 1.0.1  (bug fixes)
npm version patch

# Minor: 1.0.0 → 1.1.0  (new features, backward-compatible)
npm version minor

# Major: 1.0.0 → 2.0.0  (breaking changes)
npm version major
```

`npm version` automatically:
- Updates `version` in `package.json`
- Creates a git commit: `"1.0.1"`
- Creates a git tag: `v1.0.1`

### Step 2 — Update CHANGELOG.md

Add a new section at the top:

```markdown
## [1.0.1] - 2026-MM-DD

### Fixed
- ...

### Added
- ...

[1.0.1]: https://github.com/carrilloapps/zefer-cli/compare/v1.0.0...v1.0.1
```

Amend the version commit to include the changelog:

```bash
git add CHANGELOG.md
git commit --amend --no-edit
```

### Step 3 — Push branch and tag

```bash
git push origin main --tags
```

### Step 4 — Publish to npm manually

```bash
npm publish --otp=XXXXXX
```

Open your authenticator app, enter the 6-digit OTP. Takes 10 seconds.

### Step 5 — Create the GitHub Release (triggers binary builds)

```bash
npm run release:gh
# or:
gh release create v1.1.0 --generate-notes --title "v1.1.0"
```

The `binaries.yml` workflow triggers automatically and uploads the standalone binaries for all platforms to the release.

You can monitor the run at:
```
github.com/carrilloapps/zefer-cli/actions
```

---

## Binary build pipeline

Binaries are built automatically by `binaries.yml` on the same release event. The pipeline:

1. `npm run build` → `dist/index.js` (ESM for npm)
2. `npm run build:cjs` → `dist/index.mjs` (tsup, all deps bundled, `react-devtools-core` stubbed)
3. `bun build --compile dist/index.mjs --target bun-<platform>` → standalone binary per platform

The Bun runtime is embedded in each binary — end users need nothing pre-installed.

**Toolchain:** tsup (esbuild) → Bun compile. pkg was evaluated but crashes on yoga-layout's WebAssembly initialization.

**To build locally:**
```bash
# Requires Bun — https://bun.sh
npm run build:cjs
node scripts/build-binaries.mjs
# → binaries/zefer-linux-x64, zefer-macos-*, zefer-win-x64.exe, checksums.txt
```

## What CI checks on every push

The `ci.yml` workflow runs on every push and PR to `main`:

| Check | What it verifies |
|---|---|
| Typecheck | `tsc --noEmit` — zero TypeScript errors |
| Build | `tsup` — clean ESM bundle produced |
| Smoke: help | `zefer --help` exits 0 |
| Smoke: keygen | `zefer keygen --mode hex --length 32` produces output |
| Smoke: roundtrip | Encrypt a file, decrypt it, `diff` verifies identical output |

Tested on Node.js 20 and 22.

---

## Versioning rules

This project follows [Semantic Versioning](https://semver.org/):

| Change | Version bump |
|---|---|
| Bug fix, documentation, internal refactor | `patch` |
| New command, new option, new keygen mode | `minor` |
| Breaking CLI change (flag renamed, output format changed) | `major` |
| Binary format change (new magic bytes, new ZEFB/ZEFR version) | `major` — **must also update the web app** |

---

## Files to update on every release

| File | What to change |
|---|---|
| `CHANGELOG.md` | Add new version section |
| `package.json` | Version bumped automatically by `npm version` |

Unlike the web app, there are no social preview images or JSON-LD schemas to update.
