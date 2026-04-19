# Releasing

> [README](../README.md) · [Architecture](ARCHITECTURE.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · **Releasing**

This document covers the complete release process for zefer-cli, including the one-time GitHub Actions setup.

---

## One-time setup: npm Automation Token

Publishing from GitHub Actions requires an npm **Automation token** — unlike regular tokens, it bypasses OTP so CI can publish without human interaction.

### 1. Generate the token on npm

1. Go to **npmjs.com → Account → Access Tokens**
2. Click **Generate New Token → Granular Access Token**
3. Set:
   - **Token name**: `zefer-cli GitHub Actions`
   - **Expiration**: No expiration (or 1 year — your preference)
   - **Packages and scopes**: Select `zefer-cli`, permission **Read and write**
   - **Organizations**: none
4. Click **Generate token** and copy it immediately

> If you prefer a classic token: **Generate New Token → Classic Token → Type: Automation**

### 2. Add the token as a GitHub Secret

1. Go to **github.com/carrilloapps/zefer-cli → Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `NPM_TOKEN`
4. Value: paste the token from step 1
5. Click **Add secret**

That's it. The workflow reads `${{ secrets.NPM_TOKEN }}` automatically.

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

### Step 4 — Create the GitHub Release

```bash
# With GitHub CLI (recommended — auto-generates notes from commits)
gh release create v1.0.1 --generate-notes --title "v1.0.1"

# Or manually in GitHub UI:
# github.com/carrilloapps/zefer-cli/releases/new
# → Choose tag: v1.0.1
# → Target: main
# → Generate release notes
# → Publish release
```

### Step 5 — GitHub Actions publishes automatically

The `publish.yml` workflow triggers on `release: published` and:

1. Checks out the code
2. Runs `npm run typecheck`
3. Runs `npm run build`
4. Runs `npm publish --access public --provenance`

The `--provenance` flag links the published package to the exact GitHub Actions run that built it — verifiable at npmjs.com.

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
