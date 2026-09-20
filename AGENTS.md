# zefer-cli Agent Guidelines

## Project Overview

zefer-cli encrypts and decrypts `.zefer` files with AES-256-GCM and PBKDF2-SHA256, 100% locally. It is the official companion to the Zefer web app, and files are **fully cross-compatible** between them — same binary format, same cryptographic parameters.

- **CLI package**: [`zefer-cli` on npm](https://www.npmjs.com/package/zefer-cli) — source: https://github.com/carrilloapps/zefer-cli
- **Web app**: https://zefer.carrillo.app — source: https://github.com/carrilloapps/zefer
- **LLM context**: https://zefer.carrillo.app/llms.txt

It ships **three channels over one shared core** (`src/lib/*`):

| Channel | Entry point | Use it for |
|---|---|---|
| **CLI** | `src/index.ts` (Commander + Ink), the package `bin` | Scripting, automation, CI, terminal work |
| **MCP server** | `src/mcp/server.ts` (`zefer mcp`) | Agent tooling over stdio JSON-RPC, no wrapper needed |
| **Library** | `src/lib.ts` (`import "zefer-cli"`) | Embedding the engine in Node.js code, ESM or CommonJS |

Any change to the crypto, format, security-option or keygen layer must stay in parity across all three channels **and** the web app.

---

## Using zefer-cli from the terminal

### Install

```bash
npm install -g zefer-cli        # recommended
npx zefer-cli <command>         # without installing
```

Standalone binaries (no Node.js required) are attached to every release:
`zefer-linux-x64`, `zefer-linux-arm64`, `zefer-macos-x64`, `zefer-macos-arm64`, `zefer-win-x64.exe`.

### Core commands

```bash
zefer encrypt report.pdf -p mypassphrase          # → report.pdf.zefer
zefer encrypt --text "secret note" -p pass -o note.zefer
echo "api_key=abc123" | zefer encrypt - -p pass -o secrets.zefer
zefer decrypt report.pdf.zefer -p mypassphrase    # file mode writes, text mode prints
zefer keygen --mode secure --length 64            # 7 modes, --count for batches
zefer analyze "<password>"                        # entropy, attack scenarios, compliance
zefer info secret.zefer                           # public header only, no passphrase
```

### Full security options

```bash
zefer encrypt secret.txt \
  -p "main-passphrase" \
  -2 "second-key" --dual-key \       # two-person authorization
  --reveal "reveal-passphrase" \     # share without exposing the main key (ZEFR3)
  -q "Pet name?" -a "firulais" \     # secret question (PBKDF2-hashed answer)
  --ttl 1440 \                       # expires in 24 hours
  --max-attempts 3 \                 # 3 failed attempts = locked
  --allowed-ips "10.0.0.1,::1" \     # IPv4/IPv6 allowlist
  --hint "two parts needed" \        # public hint (visible without the passphrase)
  --note "For Alice only" \          # public note
  -c gzip \                          # compress before encrypting
  -i 1000000 \                       # 1M PBKDF2 iterations
  --verbose
```

The complete flag reference lives in [`README.md`](README.md) — treat it as the source of truth rather than copying it elsewhere.

### MCP server

```jsonc
// global install
{ "mcpServers": { "zefer": { "command": "zefer", "args": ["mcp"] } } }
// or via npx, no install required
{ "mcpServers": { "zefer": { "command": "npx", "args": ["-y", "zefer-cli", "mcp"] } } }
```

Tools: `zefer_encrypt`, `zefer_decrypt`, `zefer_keygen`, `zefer_analyze_password`, `zefer_inspect`.
Smart detection: `zefer mcp` is explicit; no args plus piped stdin auto-starts MCP; a TTY always gets the regular CLI. Per-client setup guides: [`docs/MCP.md`](docs/MCP.md) and https://zefer.carrillo.app/mcp

### Programmatic library

```js
import { encodeZefer, decodeZefer, generateWithOptions, analyzePassword } from "zefer-cli";
const { encodeZefer } = require("zefer-cli");   // CommonJS
```

The library **never auto-benchmarks** — always pass an explicit `iterations` value. Full reference: [`docs/LIBRARY.md`](docs/LIBRARY.md).

---

## Binary File Format (cross-compatible CLI ↔ web)

- **ZEFB3**: single-key files (magic: `0x5A 0x45 0x46 0x42 0x33`)
- **ZEFR3**: files with a reveal key (magic: `0x5A 0x45 0x46 0x52 0x33`)
- Chunked encryption: 16 MB per chunk, unique IV per chunk (base IV XOR chunk index, unsigned 32-bit)
- Payload: 4-byte meta length + metadata JSON + content bytes
- Auth tag: 16 bytes appended to each AES-GCM ciphertext (Web Crypto API layout)

Security metadata (expiration, secret question, IP allowlist, max attempts) lives **inside** the encrypted payload. The public header carries only `iterations`, `compression`, `hint`, `note` and `mode`.

---

## Code Rules (for AI agents editing this repo)

1. **Never change the binary format** — magic bytes, salt length (32 B), base IV length (12 B), chunk size (16 MB), auth tag size (16 B), header field names and `ZeferMeta` field names are all fixed. A real format change means new magic bytes **and** a matching release of the web app.
2. **Security metadata belongs in the encrypted payload**, never in the public header.
3. **Use the async `crypto.pbkdf2`**, never `pbkdf2Sync` — the sync version blocks the event loop and freezes the Ink UI.
4. **`>>> 0` after every bitwise XOR** that can produce a signed result (chunk IV derivation).
5. **Never hardcode Unicode characters** — spinner frames, progress blocks and icons come from `src/utils/terminal.ts`.
6. **Every path derived from decrypted content goes through `src/utils/paths.ts`.** `fileName` inside the payload is attacker-controlled; writing it unchecked is a zip-slip.
7. **Specify `authTagLength` explicitly** on every `createCipheriv` / `createDecipheriv` in GCM mode.
8. **Validate types at the boundary** — MCP arguments arrive as untyped JSON-RPC values; coerce with `asString()` before using one as a passphrase or a path.
9. **Never silence a scanner** — no `// eslint-disable`, `// NOSONAR`, `nosemgrep` or lowered thresholds. A genuine false positive gets documented scanner configuration instead.
10. **A change in `src/lib/**` lands in all three channels** — verify the CLI, the MCP server and the library, not just the one you edited.

---

## Testing and CI

```bash
npm run lint             # eslint . (flat config) — zero errors, zero warnings
npm run typecheck        # tsc --noEmit — zero errors
npm test                 # Vitest unit suite (src/**/__tests__)
npm run test:watch       # the same suite in watch mode
npm run test:coverage    # unit suite behind the coverage gate
npm run test:integration # scripts/test.mjs — 96 checks across CLI, MCP and library
npm run verify           # lint + typecheck + build + coverage + integration
```

- **498 unit tests across 23 files**, coverage enforced at **100% on statements, branches, functions and lines** over all of `src/**` (`vitest.config.ts`).
- **96 integration checks** build the package and drive the shipped binary, the real MCP stdio server and the published library, including the full cross-channel matrix (a `.zefer` written by any channel decrypts in the other two). Coverage is not measured there.
- Lowering a threshold, excluding a file or adding a `v8 ignore` hint is not an accepted way to pass the gate: write the missing test, or delete the unreachable code.

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | Push / PR to `main` | `npm ci` → lint → typecheck → unit suite at 100% coverage → 96 integration checks, on Node.js 20 and 22 |
| `.github/workflows/security.yml` | Monthly cron + `workflow_dispatch` | Semgrep, Trivy, Gitleaks and SonarQube. The first three upload SARIF to Code scanning; SonarQube skips cleanly when `SONAR_TOKEN` / `SONAR_HOST_URL` are unset |
| `.github/workflows/binaries.yml` | GitHub Release published | Builds standalone binaries for all platforms and uploads them to the release |
| `.github/dependabot.yml` | Monthly | npm + GitHub Actions updates. Two groups per ecosystem: `minor-patch` in one PR, `major` isolated. No `ignore:` rules — Dependabot applies them to security updates too |

Every action is pinned to a **full commit SHA** with the tag in a trailing comment; a mutable tag is an unreviewed code-execution channel. Use `npm ci` in CI, never `npm update`.

---

## Versioning

[Semantic Versioning](https://semver.org/spec/v2.0.0.html), strictly. See [`docs/RELEASING.md`](docs/RELEASING.md) for the full process.

| Change | Bump |
|---|---|
| Bug fix, documentation, internal refactor | `patch` |
| New command, new option, new keygen mode, new library export | `minor` |
| Breaking CLI change, or a breaking change to an exported type | `major` |
| Binary format change (new magic bytes) | `major` — **must also ship in the web app** |

Exported types count: `ParsedFile`, `ZeferHeader`, `ZeferMeta`, `EncodeOptions` and the rest of `src/lib.ts` are part of the public API surface.

---

## Documentation Map

| File | Content |
|---|---|
| [`README.md`](README.md) | Full command and flag reference, keygen modes, project tree |
| [`CLAUDE.md`](CLAUDE.md) | Repo working context: key files, invariants, common mistakes |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Technical deep dive |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model and cryptographic details |
| [`docs/LIBRARY.md`](docs/LIBRARY.md) | Programmatic API reference |
| [`docs/MCP.md`](docs/MCP.md) | MCP integration guide |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Canonical contributing guide — setup, gates, conventions |
| [`docs/RELEASING.md`](docs/RELEASING.md) | Release process and binary pipeline |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting policy |

Contact is the [GitHub profile](https://github.com/carrilloapps). Do not put email addresses in documentation.

---

## Related Project

The web app ([`carrilloapps/zefer`](https://github.com/carrilloapps/zefer), live at [zefer.carrillo.app](https://zefer.carrillo.app)) is the canonical reference for the binary format specification, the cryptographic parameters, the `ZeferMeta` schema and feature parity.

**Cross-compatibility rule**: always verify that a file encrypted by the CLI decrypts in the browser, and vice versa, before merging any change to the crypto or format layer.
