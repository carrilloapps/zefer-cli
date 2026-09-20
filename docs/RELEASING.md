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

There is no npm token in CI and no publish workflow: `npm publish` is run by
hand (step 4). A published GitHub Release triggers only the **binary build**
(`binaries.yml`).

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

The `ci.yml` workflow runs on every push and PR to `main`, on Node.js 20 and 22:

| Check | Command | What it verifies |
|---|---|---|
| Install | `npm ci` | Lockfile installed as-is (never `npm update` — npm 10.9.x has an Arborist `edgesOut` bug when re-resolving the tree) |
| Lint | `npm run lint` | ESLint flat config — zero errors, zero warnings |
| Typecheck | `npm run typecheck` | `tsc --noEmit` — zero TypeScript errors |
| Unit tests | `npm run test:coverage` | 498 tests, **100%** statements / branches / functions / lines |
| Integration | `npm run test:integration` | 96 checks across the CLI, the MCP server and the library, including the cross-channel matrix |

`npm run verify` runs the same sequence locally, plus the build, and is what
`prepublishOnly` executes before an npm publish.

## Monthly security sweep

`security.yml` runs on a monthly cron and on manual dispatch: Semgrep, Trivy,
Gitleaks and SonarQube. The first three upload SARIF, so findings appear under
**Security → Code scanning**. SonarQube is skipped cleanly when `SONAR_TOKEN` /
`SONAR_HOST_URL` are not configured, so the workflow never fails for a missing
secret.

`dependabot.yml` opens monthly dependency PRs for npm and GitHub Actions:
minor and patch updates grouped into one PR, majors isolated in their own. There
are deliberately no `ignore:` rules — Dependabot applies them to security
updates as well, so ignoring majors would silence a CVE whose only patch ships
in a major release.

All actions in every workflow are pinned to a full commit SHA with the tag in a
trailing comment. Replacing a pin with a mutable tag is a regression.

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
| `CHANGELOG.md` | Add new version section + compare link |
| `package.json` | Version bumped automatically by `npm version` |
| `README.md` | Only if a command, flag, keygen mode or library export changed |
| `docs/LIBRARY.md` | Only if the exported API surface changed |

Unlike the web app, there are no social preview images or JSON-LD schemas to update.
