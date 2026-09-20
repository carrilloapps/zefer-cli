# Changelog

All notable changes to zefer-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-09-20

A security and quality release. The major bump is driven by a single breaking
change to an exported type (see below); everything else is additive, a fix, or
tooling. The `.zefer` binary format, the cryptographic parameters and
cross-compatibility with the web app are **unchanged** — files written by any
earlier version still decrypt here, and files written here still decrypt in the
browser and in previous releases.

### Changed

- **BREAKING — `ParsedFile.encryptedLines` is now required.** It changed from
  `encryptedLines?: string[]` to `encryptedLines: string[]`, and is always
  present: the legacy text containers (ZEFER3, ZEFER2) fill it with their base64
  lines, and the binary containers (ZEFB3, ZEFR3) fill it with `[]`.

  `ParsedFile` is exported from the published library, so this is a compile-time
  break in two directions. Code that **constructs** a `ParsedFile` literal no
  longer compiles without the field, and code that **reads** it now receives `[]`
  where it previously received `undefined` — an `if (!parsed.encryptedLines)`
  guard silently stops matching, and `parsed.encryptedLines?.length` becomes `0`
  instead of `undefined`. Migration is mechanical: add `encryptedLines: []` to
  literals, and replace existence checks with `parsed.encryptedLines.length === 0`
  or with the explicit `parsed.binary` flag, which is the honest discriminator
  between the two container families.

  Runtime behaviour of `encodeZefer` / `decodeZefer` is identical.

### Security

- **Path traversal (zip-slip) when writing decrypted output.** `ZeferMeta.fileName`
  lives *inside* the encrypted payload, so it is controlled by whoever produced
  the `.zefer` file — not by the person decrypting it. A hostile file could claim
  a name like `../../../.ssh/authorized_keys` and steer the write outside the
  working directory. This affected both the **CLI** (`zefer decrypt` without
  `-o`) and the **MCP server** (`zefer_decrypt`), where the same name also
  reached the output path.

  A new module, `src/utils/paths.ts`, separates the two kinds of path that reach
  a write site. A destination the caller chose explicitly (`-o`, the MCP
  `outputPath`) is a legitimate instruction and is only normalized and checked
  for NUL bytes and emptiness (`sanitizeExplicitPath`). A payload-supplied name
  is never treated as a path at all: it is flattened across both separator
  styles, reduced to a bare file name, rejected if that name could still escape
  (`.`, `..`, or a Windows drive prefix such as `C:`, which `path.resolve` reads
  as drive-relative) and then resolved inside the current working directory
  (`sanitizeOutputName`). Windows-style names are reduced on POSIX too, so a
  hostile file behaves identically wherever it is decrypted.

- **Explicit `authTagLength` on every AES-256-GCM cipher.** `createCipheriv` and
  `createDecipheriv` in `src/lib/crypto.ts` and `src/lib/chunked-crypto.ts` now
  pass `{ authTagLength: 16 }` instead of relying on the default. The value is
  the same 16-byte tag the format has always used, so no output changes and no
  compatibility is affected — but the length is now asserted at the call site
  rather than inherited, which is what closes the door on a short-tag
  authentication bypass if a default ever shifts.

- **Type confusion in the MCP server.** MCP arguments arrive as untyped JSON-RPC
  values. A non-string argument used to be coerced with template-literal
  interpolation, so an object became the literal string `"[object Object]"` and
  then continued on as a passphrase or as a file path — a silent wrong-value bug
  instead of a clean error. Every tool argument now goes through `asString()`,
  which validates the type and rejects anything else before it reaches the
  crypto layer or the filesystem.

### Added

- **ESLint, from scratch.** The project had no linter at all. `eslint.config.mjs`
  (flat config, `typescript-eslint`) and an `npm run lint` script now cover the
  whole repository at **zero errors and zero warnings**, and lint is the first
  gate in CI.
- **A Vitest unit suite behind a 100% coverage gate.** `vitest.config.ts`
  enforces **100% statements, branches, functions and lines** over all of
  `src/**`. New scripts: `test` (single run), `test:watch`, `test:coverage` (the
  gate) and `test:integration` (the existing `scripts/test.mjs` suite, now
  reachable by name). `npm run verify` chains lint → typecheck → build →
  coverage → integration, and `prepublishOnly` runs it before every publish.
- **`.github/workflows/security.yml`** — a monthly sweep (plus manual dispatch)
  running Semgrep, Trivy, Gitleaks and SonarQube. The first three upload SARIF,
  so findings land in the repository's Security → Code scanning tab; SonarQube
  is skipped cleanly when its secrets are not configured, instead of failing the
  run.
- **`.github/dependabot.yml`** — monthly npm and GitHub Actions updates. Minor
  and patch updates are grouped into a single pull request; majors are isolated
  in their own. There are deliberately **no `ignore:` rules**, because Dependabot
  applies them to security updates as well — ignoring majors in bulk would
  silence a CVE whose only patch ships in a major release.
- **Community and agent documentation**: `AGENTS.md` (the three channels, code
  rules, testing and CI, versioning), `.github/PULL_REQUEST_TEMPLATE.md`,
  `.github/FUNDING.yml`, `.github/ISSUE_TEMPLATE/config.yml` and
  `.github/ISSUE_TEMPLATE/security_vulnerability.md`.

### Fixed

- **`zefer info` never actually detected ZEFER2 files.** The format branch was
  written so that the ZEFER2 case could not be reached, leaving that legacy
  container mislabelled. Detection now lives in a dedicated `detectFormat()` and
  reports ZEFB3, ZEFR3, ZEFER3 and ZEFER2 correctly.
- **`binaries.yml`: shell injection through `${{ github.ref_name }}`.** The
  release tag was interpolated straight into a `run:` block, where the value is
  substituted before the shell parses the script. It is now passed through
  `env:` and read as `"$RELEASE_TAG"`, so its contents can never be parsed as
  shell.
- **Every GitHub Action pinned to a full commit SHA**, with the tag kept in a
  trailing comment. A mutable tag (`@v4`) can be re-pointed at any time by
  whoever controls the action repository, which makes it an unreviewed
  code-execution channel inside the workflow.
- `overrides.esbuild` added, pulling the transitive `esbuild` (via tsup and tsx)
  onto a patched version.
- `scripts/build-binaries.mjs`, `scripts/clean.mjs`, `scripts/release-gh.mjs`
  and `scripts/test.mjs` cleaned up under the new lint rules.

### Tests

- **498 unit tests across 23 files**, at 100% coverage on all four metrics.
  Tests live in `__tests__` directories next to the code they cover: Ink
  components are rendered with `ink-testing-library`, and the MCP server is
  driven through its real stdio JSON-RPC loop over a fake stdin/stdout pair.
- The **96 integration checks** in `scripts/test.mjs` are unchanged and remain
  deliberately separate: they build the package and exercise the shipped binary,
  the MCP server and the published library, including the cross-channel matrix.

[2.0.0]: https://github.com/carrilloapps/zefer-cli/compare/v1.4.0...v2.0.0

## [1.4.0] - 2026-06-15

### Changed

- **The 512 MB decompression cap is now library-only.** `decodeZefer`'s decompression-bomb safety limit (`MAX_DECOMPRESS_SIZE`, 512 MB) still applies by default — protecting services that decrypt untrusted, attacker-supplied input — but the **CLI** (`zefer decrypt`) and the **MCP server** (`zefer_decrypt`) now pass `maxDecompressSize: 0`, removing the cap entirely. Both channels operate on local, trusted files, so a large file is never rejected for its size; the CLI reports decryption progress as a percentage exactly as before. No `.zefer` format, crypto, or cross-compatibility change.

### Added

- **`decodeZefer` option `maxDecompressSize`** (bytes) — overrides the decompression-bomb cap. Defaults to 512 MB; pass `0` (or a non-finite value) to disable it. `decompressBytes` gains a matching optional `maxSize` parameter and `MAX_DECOMPRESS_SIZE` is now exported. Full reference: [`docs/LIBRARY.md`](docs/LIBRARY.md).
- **`npx` usage examples throughout the docs** — every CLI command in the README (`encrypt`, `decrypt`, `keygen`, `analyze`, `info`) and the `claude mcp add` snippet in [`docs/MCP.md`](docs/MCP.md) now show a no-install `npx zefer-cli …` form alongside the global-install form.

[1.4.0]: https://github.com/carrilloapps/zefer-cli/compare/v1.3.0...v1.4.0

## [1.3.0] - 2026-06-12

### Added

- **Programmatic library — zefer is now usable as a third channel** (alongside the CLI and the MCP server). A new side-effect-free entry point (`src/lib.ts` → `dist/lib.js` / `dist/lib.cjs`) exposes the full core as an importable API with TypeScript declarations (`dist/lib.d.ts` / `dist/lib.d.cts`), shipped in both **ESM** and **CommonJS**. It contains no Ink, React, Commander or `process.argv` parsing, so importing it has zero side effects — safe in any Node 20+ runtime, including services and AWS Lambda. Files stay byte-for-byte compatible across all channels and the web app.

  ```ts
  import { encodeZefer, decodeZefer, generateWithOptions, analyzePassword } from "zefer-cli";
  // or: const { encodeZefer } = require("zefer-cli");
  ```

  Full surface exported: format (`encodeZefer`, `decodeZefer`, `parseFile`), AES-256-GCM + PBKDF2 primitives (`encrypt`/`decrypt`, `encryptRaw`, `decryptFromBinary`, `deriveKey`, `combineDualKeys`, `hashAnswer`, `benchmarkDevice`), 16 MB chunked crypto (`chunkedEncrypt`, `chunkedDecryptToBuffer`, `CHUNK_SIZE`), compression (`compressBytes`, `decompressBytes`, `smartCompress`), the 7-mode key generator and password analysis (`generateValue`, `generateWithOptions`, `MODES`, `analyzePassword`, …) and the attempt counter. All security layers — dual passphrase, reveal key (ZEFR3), secret question, TTL, IP allowlist, max attempts, compression — are available programmatically. Full reference and Lambda guidance: [`docs/LIBRARY.md`](docs/LIBRARY.md).
- New build scripts `build:cli` and `build:lib`; `build` now produces both the CLI/MCP bundle and the dual-format library + types.

### Changed

- `exports["."]` now resolves to the **library** (with `import`/`require` conditions and bundled types), and `main`/`module`/`types` were added. Previously `exports["."]` pointed at the CLI bundle, which was not importable (it would parse `process.argv` and render the terminal UI). The `bin` entries (`zefer`, `zefer-cli`) are unchanged — the CLI is reached through the bin exactly as before.

### Removed

- Dead module `src/lib/keygen.ts` — an orphaned, superseded key generator (5 modes, no advanced options) that no code imported. Key generation lives in `src/lib/passwords.ts` (7 modes: `unicode|secure|alpha|hex|base58|pin|uuid`), shared by the CLI, the MCP server and the library. Stale references in `CLAUDE.md` and `docs/CONTRIBUTING.md` were corrected.

### Tests

- Smoke suite expanded from 26 to 96 checks, validating **all three channels** at runtime and the full **cross-channel matrix** — a `.zefer` produced by any channel decrypts in the other two. Adds the real MCP stdio server driven over JSON-RPC (all 5 tools), ESM ⇄ CJS library parity, every security layer and every low-level primitive.

[1.3.0]: https://github.com/carrilloapps/zefer-cli/compare/v1.2.1...v1.3.0

## [1.2.1] - 2026-06-09

### Fixed

- **Broken npm package (1.2.0 was unusable)** — the published 1.2.0 tarball shipped only `dist/index.js` because the `files` allowlist in `package.json` was a hardcoded two-file list. When the MCP server landed in 1.2.0, tsup began code-splitting the ESM bundle into `dist/chunk-*.js` (shared code, statically imported by `index.js`) and `dist/server-*.js` (the lazily `import()`-ed MCP server). Neither was included in `files`, so every install crashed on first invocation — even `zefer --version` — with `ERR_MODULE_NOT_FOUND: Cannot find package './chunk-XXXXXXXX.js'`. The bug was invisible locally because the chunks exist on disk after a build; only a clean install from the tarball exposes it. `files` now uses `dist/*.js` + `dist/*.js.map` globs so all current and future code-split chunks are published, while the binary build's `dist/index.mjs` stays excluded. See [`docs/POSTMORTEM-1.2.0.md`](docs/POSTMORTEM-1.2.0.md). No code, crypto, or `.zefer` format changes — 1.2.1 is feature-identical to the intended 1.2.0.

[1.2.1]: https://github.com/carrilloapps/zefer-cli/compare/v1.2.0...v1.2.1

## [1.2.0] - 2026-06-05

### Added

- **`zefer mcp` — MCP server (Model Context Protocol)**: exposes every capability as MCP tools over stdio (newline-delimited JSON-RPC 2.0, dependency-free): `zefer_encrypt`, `zefer_decrypt`, `zefer_keygen`, `zefer_analyze_password`, `zefer_inspect`. Auto-detection: launching the binary with no arguments and piped stdin (how MCP clients spawn servers) starts MCP mode automatically; a TTY terminal still gets the regular CLI. Client config: `{ "mcpServers": { "zefer": { "command": "zefer", "args": ["mcp"] } } }`
- **`zefer analyze [password]`** — full security report for any password (prompted securely if omitted): score, estimated alphabet, maximum/effective entropy, total keyspace, post-quantum entropy, crack time across 4 attack scenarios (10^2-10^15 guesses/s), compliance checks (NIST SP 800-63B, OWASP >=64 bits, long-term >=100 bits, AES-128, post-quantum Grover), comparison vs an average human password and weakness detection — parity with the web /generator analyzer
- **`zefer info` deep analysis** — structural integrity (chunk-framing walk, corruption/truncation detection), encrypted chunk count, estimated content size, ciphertext randomness (Shannon entropy), salt/IV hex, file SHA-256 fingerprint, passphrase-resistance table derived from the file's PBKDF2 iterations, and severity-tagged security observations — parity with the web /analyzer
- **`zefer keygen` web parity** — shared engine with the web app: 7 modes (`unicode|secure|alpha|hex|base58|pin|uuid`), every key scored with a strength bar and effective bits, plus advanced options: `--exclude-ambiguous`, `--exclude <chars>`, `--require-all`, `--no-repeats`, `--group <n>`, `--sort` (strongest first) and `--quiet` (raw values for piping)

### Changed

- **Breaking**: `keygen` charsets now match the web app exactly — `secure` is Latin + symbols + accents (was base64url), `alpha` is strictly alphanumeric (was ASCII + symbols), `unicode` uses the curated web pool, and `uuid` generates UUID v7 (RFC 9562, was v4). Use `--quiet` for script-friendly output

> **Note:** 1.2.0 was published to npm with a broken tarball (missing code-split chunks) and is unusable. Use 1.2.1 instead.

[1.2.0]: https://github.com/carrilloapps/zefer-cli/compare/v1.1.1...v1.2.0

## [1.1.1] - 2026-04-19

### Changed

- npm install is now the **recommended** install method (Option 1) — standalone binary is Option 2.
- README Quick Start restructured: npm first (with npx), binaries second with per-platform download links and commands.
- Removed `publish.yml` GitHub Actions workflow — npm publish is done manually with `npm publish --otp=XXXXX`.
- `docs/RELEASING.md` updated to reflect manual publish flow.

[1.1.1]: https://github.com/carrilloapps/zefer-cli/compare/v1.1.0...v1.1.1

## [1.1.0] - 2026-04-19

### Added

- **Standalone binaries for all platforms** — no Node.js or npm required:
  - `zefer-linux-x64`, `zefer-linux-arm64`
  - `zefer-macos-x64` (Intel), `zefer-macos-arm64` (Apple Silicon)
  - `zefer-win-x64.exe`
  - `checksums.txt` (SHA-256 for each binary)
- **Version reads from `package.json`** — `zefer --version` always reports the correct installed version.
- **Complete npm script suite:**
  - `build:watch` — tsup watch mode for development
  - `build:cjs` — ESM bundle with all deps inlined (used by binary builder)
  - `build:all` — builds both ESM (npm) and CJS (binary) bundles
  - `build:binary` — builds all platform binaries
  - `build:binary:linux-x64|linux-arm64|macos-x64|macos-arm64|win-x64` — single platform
  - `build:binary:current` — builds binary for the current machine only
  - `clean` — removes `dist/` and `binaries/`
  - `verify` — typecheck + build + version check (gates npm publish)
  - `test` — 26-check smoke test suite
  - `release:patch|minor|major` — bump version (auto-pushes tag via `postversion`)
  - `release:gh` — create GitHub release (triggers automated npm publish + binary build)
- **`scripts/test.mjs`** — 26 smoke tests: version, help, all keygen modes, encrypt/decrypt round-trips (text, file, gzip), wrong passphrase, hint/note visibility.
- **`scripts/clean.mjs`** — cross-platform artifact cleanup (no rimraf needed).
- **`scripts/release-gh.mjs`** — creates GitHub release, triggers both `publish.yml` and `binaries.yml`.
- **`scripts/build-binaries.mjs`** — now supports `--target <id>` and `--current` flags for per-platform builds.
- **`package.json` best practices** — added `publishConfig`, `funding`, `sideEffects: false`, `engines.npm`.
- **CI updated** — uses `npm test` (26 smoke checks) instead of inline shell commands.

### Changed

- `prepublishOnly` now runs `npm run verify` (typecheck + build + version check).
- `dev` now uses `tsx watch` for hot-reload during development.

[1.1.0]: https://github.com/carrilloapps/zefer-cli/compare/v1.0.2...v1.1.0

## [1.0.2] - 2026-04-19

### Added

- **Standalone binaries** — prebuilt executables for Linux x64/ARM64, macOS Intel/Apple Silicon, and Windows x64. No Node.js or npm required. Download from [GitHub Releases](https://github.com/carrilloapps/zefer-cli/releases).
- **`npm run build:cjs`** — builds `dist/index.mjs` (all deps bundled inline) for the binary pipeline.
- **`npm run build:binary`** — builds all platform binaries locally (requires Bun).
- **`scripts/build-binaries.mjs`** — build script that cross-compiles with `bun build --compile` for all targets.
- **`tsup.binary.config.ts`** — tsup config for the binary bundle (ESM, no splitting, `react-devtools-core` stubbed).
- **`.github/workflows/binaries.yml`** — GitHub Actions workflow that builds and uploads binaries to every release.
- **`binaries/checksums.txt`** — SHA-256 checksums for verifying downloads.

### Changed

- README Quick Start section restructured into three options: binary download, npm, and source.

[1.0.2]: https://github.com/carrilloapps/zefer-cli/compare/v1.0.1...v1.0.2

## [1.0.1] - 2026-04-19

### Fixed

- **`npx zefer-cli`** — added `zefer-cli` as a second bin entry so `npx zefer-cli <command>` resolves correctly. Global install still provides the `zefer` command.

### Added

- **GitHub Actions** — `ci.yml` runs typecheck + build + encrypt/decrypt roundtrip smoke test on Node.js 20 and 22 on every push and PR. `publish.yml` publishes to npm automatically when a GitHub Release is created.
- **`docs/RELEASING.md`** — complete release guide: npm Automation token setup, step-by-step version workflow, versioning rules.
- **Cross-links with zefer web app** — READMEs, CLAUDE.md files, and badges now link both projects together.

[1.0.1]: https://github.com/carrilloapps/zefer-cli/compare/v1.0.0...v1.0.1

## [1.0.0] - 2026-04-18

### New

- **`zefer encrypt`** — Encrypt any file or text with AES-256-GCM. Reads from file path, `--text`, or stdin (`-`). Writes to `.zefer` or custom path with `-o`.
- **`zefer decrypt`** — Decrypt any `.zefer` file. Outputs to stdout (text mode) or original filename (file mode). Reads from file or stdin.
- **`zefer keygen`** — Generate cryptographically secure keys. Five modes: `alpha`, `hex`, `uuid`, `secure`, `unicode`. Configurable length and count.
- **`zefer info`** — Display the public header of a `.zefer` file without decryption: format, mode, iterations, compression, hint, note.
- **ZEFB3 / ZEFR3 binary format** — Full encode and decode support, byte-for-byte compatible with [zefer.carrillo.app](https://zefer.carrillo.app)
- **Legacy format support** — Read-only decode for ZEFER3 (text) and ZEFER2 (legacy text) formats
- **Dual passphrase** (`--dual-key` + `-2`) — Two-person authorization. Combines keys with `\x00ZEFER_DUAL\x00` separator, identical to the web app
- **Reveal key** (`--reveal`) — Creates ZEFR3 dual-block file. Recipient can decrypt with reveal key without knowing the main passphrase
- **Secret question** (`-q` + `-a`) — Additional authentication. Answer normalized (trim + lowercase), hashed with PBKDF2 (100,000 iterations)
- **IP restriction** (`--allowed-ips`) — IPv4/IPv6 allowlist stored inside the encrypted payload
- **Expiration** (`--ttl`) — Millisecond-precision expiration stored as Unix timestamp inside the encrypted payload
- **Max decryption attempts** (`--max-attempts`) — Attempt counter persisted at `~/.zefer/attempts.json`
- **Public hint** (`--hint`) + **public note** (`--note`) — Stored in the unencrypted header
- **Auto-benchmark** — When `--iterations 0` (default), runs a quick PBKDF2 benchmark to pick optimal iteration count (300k / 600k / 1M)
- **Gzip / Deflate compression** (`-c`) — Applied before encryption. Skipped automatically if it increases size
- **Chunked encryption** — Splits data into 16 MB chunks with unique IVs. Constant memory usage regardless of file size
- **Real-time progress bar** (Ink) — Shows stage (Reading → Compressing → Deriving → Encrypting → Writing) with chunk-based percentage
- **Animated spinner** — Braille on Unicode terminals, `/-\|` on legacy terminals
- **Cross-platform terminal support** — Unicode on Linux/macOS/Windows Terminal, ASCII fallback on `cmd.exe`. Password input hidden on all platforms
- **Pipe support** — Read from stdin with `-` input, print to stdout in text-mode decrypt
- **`--verbose` flag** — Shows all security options before the operation begins
- **`--force` flag** — Overwrite existing output files
- **Timing attack mitigation** — Minimum 100ms response on wrong passphrase (identical to web app)
- **ESM bundle** — Single 50 KB `dist/index.js` built with tsup, shebang included
- **npm global install** — `npm install -g zefer-cli` creates `zefer` (Unix), `zefer.cmd` (cmd.exe), `zefer.ps1` (PowerShell)

[1.0.0]: https://github.com/carrilloapps/zefer-cli/releases/tag/v1.0.0
