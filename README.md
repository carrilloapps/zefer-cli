<div align="center">

<img src="https://zefer.carrillo.app/icon.svg" alt="Zefer" width="80" height="80" />

# zefer-cli

**The zefer encryption tool — now for your terminal.**

CLI companion to [zefer.carrillo.app](https://zefer.carrillo.app). Encrypt and decrypt `.zefer` files directly from the command line using AES-256-GCM. 100% offline, cross-platform, fully compatible with the web app.

[![npm](https://img.shields.io/npm/v/zefer-cli?style=flat-square&color=22c55e)](https://www.npmjs.com/package/zefer-cli)
[![CI](https://img.shields.io/github/actions/workflow/status/carrilloapps/zefer-cli/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/carrilloapps/zefer-cli/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/carrilloapps/zefer-cli?style=flat-square&color=22c55e)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Built with Ink](https://img.shields.io/badge/Built%20with-Ink-61dafb?style=flat-square&logo=react&logoColor=000)](https://github.com/vadimdemedes/ink)
[![Web App](https://img.shields.io/badge/Web%20App-zefer.carrillo.app-22c55e?style=flat-square)](https://zefer.carrillo.app)
[![Web Repo](https://img.shields.io/badge/GitHub-zefer-181717?style=flat-square&logo=github)](https://github.com/carrilloapps/zefer)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-22c55e?style=flat-square)](docs/CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/carrilloapps/zefer-cli?style=flat-square&color=22c55e)](https://github.com/carrilloapps/zefer-cli/stargazers)

<br />

[Web App](https://zefer.carrillo.app) · [Report Bug](https://github.com/carrilloapps/zefer-cli/issues/new?template=bug_report.md) · [Request Feature](https://github.com/carrilloapps/zefer-cli/issues/new?template=feature_request.md) · [Web App Repo](https://github.com/carrilloapps/zefer) · [Documentation](docs/)

</div>

---

## Table of Contents

- [About](#about)
- [Relationship to zefer](#relationship-to-zefer)
- [Features](#features)
- [File Format Compatibility](#file-format-compatibility)
- [Quick Start](#quick-start)
- [Commands](#commands)
- [Library (programmatic API)](#library-programmatic-api)
- [Security Options](#security-options)
- [Scripting & Automation](#scripting--automation)
- [Cross-platform Support](#cross-platform-support)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Security Model](#security-model)
- [Contributing](#contributing)
- [Author](#author)
- [Support](#support)
- [License](#license)

---

## About

zefer-cli brings the full power of [zefer](https://zefer.carrillo.app) to your terminal. Encrypt text and files into password-protected `.zefer` files using AES-256-GCM — the same cryptographic standard used by the web app. Every file you create here can be opened in the browser, and vice versa.

- **Zero-knowledge** — no network requests during encryption or decryption
- **Cross-compatible** — `.zefer` files work identically in CLI and browser
- **All security features** — dual key, reveal key, secret question, IP restriction, expiration, attempt limits
- **Scriptable** — pipe-friendly, all options via flags, CI-friendly output mode
- **AI-ready** — built-in [MCP server](#zefer-mcp--mcp-server) exposes every capability to Claude, Cursor, Windsurf, VS Code and any MCP client

## Relationship to zefer

zefer-cli is the official CLI companion to the [zefer web app](https://github.com/carrilloapps/zefer). Both projects are maintained by the same author and share:

| Component | Web App | CLI |
|---|---|---|
| Binary format | ZEFB3 / ZEFR3 | ZEFB3 / ZEFR3 (identical) |
| Encryption | AES-256-GCM (Web Crypto API) | AES-256-GCM (Node.js crypto) |
| Key derivation | PBKDF2-SHA256 | PBKDF2-SHA256 (identical params) |
| Compression | CompressionStream API | Node.js zlib (same output) |
| File compatibility | Reads/writes `.zefer` | Reads/writes `.zefer` |

A file encrypted with `zefer-cli` can be decrypted at [zefer.carrillo.app](https://zefer.carrillo.app) and vice versa.

## Features

<table>
<tr>
<td width="50%">

**Core Encryption**
- AES-256-GCM with PBKDF2-SHA256 (300k–1M iterations)
- Text mode and file mode (any format, any size)
- Chunked encryption (16 MB per chunk, unique IVs)
- Gzip / Deflate compression before encryption
- Auto-benchmark: picks optimal iteration count for the current machine

</td>
<td width="50%">

**Security Layers**
- Dual passphrase — two-person authorization (`-2`)
- Reveal key — share without exposing main key (`-r`)
- Secret question with PBKDF2-hashed answer (100k iterations)
- IP restriction — IPv4/IPv6 allowlist (`--allowed-ips`)
- Expiration — TTL in minutes (`--ttl`)
- Max decryption attempts (`--max-attempts`)
- Attempt counter persisted at `~/.zefer/attempts.json`

</td>
</tr>
<tr>
<td width="50%">

**Developer Experience**
- Three channels, one core: **CLI**, **MCP server** and **programmatic library**
- Library: import as ESM or CommonJS — `encodeZefer`, `decodeZefer`, keygen, analysis
- Pipe-friendly: `stdin` / `stdout` support
- Non-interactive mode for CI/CD scripts
- Cross-platform: Linux, macOS, Windows
- ASCII fallback for `cmd.exe` and legacy terminals
- `--verbose` for detailed operation info

</td>
<td width="50%">

**Key Generator & AI**
- 7 modes: `unicode`, `secure`, `alpha`, `hex`, `base58`, `pin`, `uuid` (v7)
- Per-key strength score + advanced options (exclusions, classes, grouping)
- `zefer analyze` — full password security report
- **MCP server** (`zefer mcp`) — every capability as AI-agent tools
- Rejection sampling — no modulo bias, OS-level CSPRNG

</td>
</tr>
</table>

## File Format Compatibility

All `.zefer` files follow the same binary format used by the web app:

### ZEFB3 — Single passphrase

```
[ZEFB3 magic — 5 bytes]
[header length — 4 bytes big-endian]
[header JSON — public, not encrypted]
[salt — 32 bytes][base IV — 12 bytes]
[encrypted chunks — 16 MB each, unique IV per chunk]
```

### ZEFR3 — With reveal key

```
[ZEFR3 magic — 5 bytes]
[header length — 4 bytes big-endian]
[header JSON — public, not encrypted]
[main block size — 4 bytes]
[main block: salt + IV + chunks]    ← encrypted with main passphrase
[reveal block: salt + IV + chunks]  ← encrypted with reveal key
```

**Public header** (readable without a passphrase): `iterations`, `compression`, `hint`, `note`, `mode`

**Encrypted payload** (invisible without the key): file metadata, expiration, secret question hash, IP allowlist, max attempts

> Legacy formats ZEFER3 and ZEFER2 are supported for backward-compatible decryption only.

## Quick Start

### Option 1 — Via npm ✦ recommended

```bash
npm install -g zefer-cli
```

The command is **`zefer`** (no suffix):

```bash
zefer encrypt document.pdf -p mypassword
zefer decrypt document.pdf.zefer -p mypassword
zefer keygen
zefer info secret.zefer
```

Or run without installing:

```bash
npx zefer-cli encrypt document.pdf -p mypassword
```

---

### Option 2 — Standalone binary (no Node.js required)

Download the prebuilt binary for your platform from the [latest release](https://github.com/carrilloapps/zefer-cli/releases/latest):

| Platform | File | Download |
|---|---|---|
| Linux x64 | `zefer-linux-x64` | [↓ Download](https://github.com/carrilloapps/zefer-cli/releases/latest/download/zefer-linux-x64) |
| Linux ARM64 | `zefer-linux-arm64` | [↓ Download](https://github.com/carrilloapps/zefer-cli/releases/latest/download/zefer-linux-arm64) |
| macOS Intel | `zefer-macos-x64` | [↓ Download](https://github.com/carrilloapps/zefer-cli/releases/latest/download/zefer-macos-x64) |
| macOS Apple Silicon | `zefer-macos-arm64` | [↓ Download](https://github.com/carrilloapps/zefer-cli/releases/latest/download/zefer-macos-arm64) |
| Windows x64 | `zefer-win-x64.exe` | [↓ Download](https://github.com/carrilloapps/zefer-cli/releases/latest/download/zefer-win-x64.exe) |

**Linux / macOS:**
```bash
curl -L https://github.com/carrilloapps/zefer-cli/releases/latest/download/zefer-linux-x64 -o zefer
chmod +x zefer
sudo mv zefer /usr/local/bin/zefer   # install system-wide (optional)
zefer --help
```

**macOS Apple Silicon:**
```bash
curl -L https://github.com/carrilloapps/zefer-cli/releases/latest/download/zefer-macos-arm64 -o zefer
chmod +x zefer
sudo mv zefer /usr/local/bin/zefer
zefer --help
```

**Windows (PowerShell):**
```powershell
Invoke-WebRequest -Uri https://github.com/carrilloapps/zefer-cli/releases/latest/download/zefer-win-x64.exe -OutFile zefer.exe
.\zefer.exe --help
```

**Verify integrity** with the `checksums.txt` included in each release:
```bash
curl -L https://github.com/carrilloapps/zefer-cli/releases/latest/download/checksums.txt | sha256sum -c --ignore-missing
```

---

### Option 3 — From source

```bash
git clone https://github.com/carrilloapps/zefer-cli.git
cd zefer-cli
npm install
npm run build
node dist/index.js --help
```

### Verify

```bash
npx tsc --noEmit    # Type check
npm run build        # Build
```

## Commands

### `zefer encrypt`

```
zefer encrypt [input] [options]

Arguments:
  input                   File to encrypt. Use "-" to read from stdin.

Options:
  -o, --output <path>     Output path  (default: <input>.zefer)
  -p, --passphrase <p>    Passphrase   (prompted if omitted)
  -2, --second <p>        Second passphrase — enables dual-key mode
  -r, --reveal <key>      Reveal key   — creates ZEFR3 dual-block file
  -t, --text <content>    Encrypt text directly instead of a file
  --hint <hint>           Public hint  (visible without passphrase)
  --note <note>           Public note  (visible without passphrase)
  -q, --question <q>      Secret question
  -a, --answer <a>        Secret question answer
  --ttl <minutes>         Expiration in minutes. 0 = never  (default: 0)
  -i, --iterations <n>    PBKDF2 iterations. 0 = auto-benchmark  (default: 0)
  -c, --compression <m>   none | gzip | deflate | deflate-raw  (default: none)
  --max-attempts <n>      Max decryption attempts. 0 = unlimited  (default: 0)
  --allowed-ips <ips>     Comma-separated IP allowlist (IPv4 or IPv6)
  --dual-key              Enable dual-key mode (requires --second)
  --verbose               Show security details before encrypting
```

**Examples:**

```bash
# Encrypt a file (passphrase prompted)
zefer encrypt report.pdf

# Encrypt with all options
zefer encrypt secret.txt \
  -p "main-passphrase" \
  -2 "second-key" \
  --dual-key \
  --reveal "reveal-passphrase" \
  -q "What is your pet's name?" \
  -a "firulais" \
  --ttl 1440 \
  --max-attempts 3 \
  --hint "two parts required" \
  -c gzip \
  -o secret.zefer \
  --verbose

# Encrypt text directly
zefer encrypt --text "Top secret note" -p mypassword -o note.zefer

# Pipe from stdin
echo "my secret" | zefer encrypt -p mypassword -o secret.zefer
cat document.pdf | zefer encrypt -p mypassword -o document.zefer
```

---

### `zefer decrypt`

```
zefer decrypt <input> [options]

Arguments:
  input                   .zefer file to decrypt. Use "-" to read from stdin.

Options:
  -o, --output <path>     Output path.
                          Default: stdout for text mode, original filename for file mode.
  -p, --passphrase <p>    Passphrase (prompted if omitted)
  -2, --second <p>        Second passphrase (dual-key mode)
  -a, --answer <a>        Secret question answer (prompted if needed)
  --force                 Overwrite existing output file
  --verbose               Show public file info before decrypting
```

**Examples:**

```bash
# Decrypt (passphrase prompted)
zefer decrypt secret.zefer

# Decrypt to stdout (text mode)
zefer decrypt note.zefer -p mypassword

# Decrypt with all options
zefer decrypt secret.zefer \
  -p "main-passphrase" \
  -2 "second-key" \
  -a "firulais" \
  -o recovered.txt \
  --force

# Pipe the output
zefer decrypt note.zefer -p mypassword | grep "important"

# Use the reveal key instead of the main passphrase
zefer decrypt secret.zefer -p "reveal-passphrase" -a "firulais"
```

---

### `zefer keygen`

```
zefer keygen [options]

Options:
  -m, --mode <mode>      unicode | secure | alpha | hex | base58 | pin | uuid  (default: secure)
  -l, --length <n>       Length in characters, 1-2048  (default: 64)
  -n, --count <n>        Number of keys, 1-50  (default: 1)
  --exclude-ambiguous    Exclude ambiguous characters (0 O 1 l I)
  --exclude <chars>      Exclude specific characters from the alphabet
  --require-all          Guarantee lower/upper/digit/symbol when available
  --no-repeats           Never emit the same character twice in a row
  --group <n>            Insert a dash every N characters (cosmetic)
  --sort                 Sort keys from strongest to weakest score
  --quiet                Raw values only (pipe-friendly, no analysis)
```

Every key is scored (strength bar + effective bits), exactly like the web `/generator`.

| Mode | Character set | Best for |
|---|---|---|
| `unicode` | Latin, Cyrillic, Arabic, CJK, Greek, Emoji (~668 symbols) | Maximum entropy |
| `secure` | Latin + symbols + accented (189 symbols) | General passphrases |
| `alpha` | `A-Z a-z 0-9` | Alphanumeric tokens |
| `hex` | `0-9 a-f` | Tokens, hashes |
| `base58` | Bitcoin alphabet (no `0 O I l`) | Keys read aloud or hand-copied |
| `pin` | `0-9` | Devices, cards, safes |
| `uuid` | UUID v7 (RFC 9562) | Unique identifiers |

**Examples:**

```bash
zefer keygen                                  # 64-char secure key, scored
zefer keygen -m base58 -l 24 --group 6        # XqaiTi-CBpTQC-3Em58S-X9u4XQ
zefer keygen -m pin -l 8                      # numeric PIN
zefer keygen -n 10 --sort                     # 10 keys, strongest first
zefer keygen --exclude-ambiguous --require-all
zefer keygen --quiet -n 5                     # raw values for piping
```

---

### `zefer mcp` — MCP server

Exposes **every zefer capability as [Model Context Protocol](https://modelcontextprotocol.io) tools** over stdio, so any MCP-compatible client (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, custom agents) can encrypt, decrypt, generate and analyze locally. Dependency-free JSON-RPC — works in the npm install and in every standalone binary.

Full integration guide (all clients, transports, tool schemas, troubleshooting): [docs/MCP.md](docs/MCP.md)

```jsonc
// Client configuration (e.g. .mcp.json, claude_desktop_config.json)

// Option A — global install (npm install -g zefer-cli)
{
  "mcpServers": {
    "zefer": { "command": "zefer", "args": ["mcp"] }
  }
}

// Option B — via npx, no install required
{
  "mcpServers": {
    "zefer": { "command": "npx", "args": ["-y", "zefer-cli", "mcp"] }
  }
}
```

| Tool | What it does |
|---|---|
| `zefer_encrypt` | Encrypt text or a file into `.zefer` (all options: dual key, reveal key, TTL, question, compression, IPs…) |
| `zefer_decrypt` | Decrypt a `.zefer` file — text returned inline, files written to disk |
| `zefer_keygen` | Generate scored keys — 7 modes + advanced options, sorted strongest first |
| `zefer_analyze_password` | Full strength report: entropy, 4 attack scenarios, NIST/OWASP/AES-128/post-quantum compliance |
| `zefer_inspect` | Deep `.zefer` analysis without the passphrase: structure, entropy, SHA-256, KDF resistance, observations |

**Smart detection** — the binary knows how it was launched:

- `zefer mcp` → MCP server (explicit)
- spawned with **no arguments + piped stdin** (how MCP clients start servers) → MCP server (automatic)
- a human terminal (TTY) → regular CLI, always

**Example tool call** (what your agent sends under the hood):

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"zefer_encrypt",
 "arguments":{"text":"api_key=abc123","passphrase":"my-strong-pass",
              "outputPath":"secret.zefer","ttlMinutes":1440,"compression":"gzip"}}}
```

Everything runs locally — no network, no telemetry, passphrases never leave the machine.

---

### `zefer analyze`

Full security report for any password — parity with the web `/generator` analyzer.

```
zefer analyze [password]      # prompted securely if omitted
```

Reports: strength score, estimated alphabet, maximum/effective entropy, total
keyspace, post-quantum entropy (Grover), crack time across 4 attack scenarios
(throttled login 10²/s → nation-state 10¹⁵/s), compliance checks (NIST SP
800-63B, OWASP ≥64 bits, long-term ≥100 bits, AES-128, post-quantum) and
weakness detection (leaked lists, sequences, keyboard patterns, repeats, years).
100% local — the password never leaves your machine.

---

### `zefer info`

Shows the public header **plus a deep security analysis** (parity with the web
`/analyzer`): structural integrity (chunk-framing walk, corruption detection),
encrypted chunk count, estimated content size, ciphertext randomness (Shannon
entropy), salt/IV hex, file SHA-256 fingerprint, a passphrase-resistance table
derived from the file's PBKDF2 iterations, and severity-tagged security
observations — all without the passphrase.

Show the public header of a `.zefer` file without decrypting it.

```bash
zefer info secret.zefer
```

```
▸ zefer info
  secret.zefer
────────────────────────────────────────────────

File            secret.zefer (943 B)
Format          ZEFR3 (binary, with reveal key)
Mode            file
Iterations      1,000,000
Compression     gzip
Hint            two parts required

Secret question, IP restriction, expiration, and max attempts
are inside the encrypted payload and cannot be read without the passphrase.
```

---

## Library (programmatic API)

Beyond the CLI and the MCP server, `zefer-cli` ships a **programmatic library**:
the same core, importable from your own Node.js code (services, AWS Lambda,
build scripts). No Ink, no Commander, no side effects on import — and files stay
byte-for-byte compatible across all channels and the web app.

The package exports both **ESM** and **CommonJS** builds with full TypeScript types.

```ts
// ESM / TypeScript
import { encodeZefer, decodeZefer, generateWithOptions, analyzePassword } from "zefer-cli";

// CommonJS
const { encodeZefer, decodeZefer } = require("zefer-cli");
```

**Encrypt → decrypt round-trip:**

```ts
import { encodeZefer, decodeZefer } from "zefer-cli";
import { readFile, writeFile } from "node:fs/promises";

// Encrypt text (ZEFB3 binary, gzip-compressed)
const buf = await encodeZefer({
  content: "api_key=abc123",
  passphrase: "a-strong-passphrase",
  fileName: null,
  expiresAt: 0,            // 0 = never; else Unix ms
  compression: "gzip",
  iterations: 600_000,     // always explicit — the library never auto-benchmarks
});
await writeFile("secret.zefer", buf);

// Decrypt (pass the raw bytes via `rawBytes` for ZEFB3/ZEFR3)
const bytes = await readFile("secret.zefer");
const res = await decodeZefer(bytes.toString("utf-8"), "a-strong-passphrase", { rawBytes: bytes });
if (res.ok) {
  console.log(res.payload.content);     // text mode
  // res.payload.fileData                // file mode (Buffer)
}
```

**Encrypt a file (file mode):**

```ts
const data = await readFile("photo.jpg");
const buf = await encodeZefer({
  fileData: data,
  fileName: "photo.jpg",
  fileType: "image/jpeg",
  passphrase: "a-strong-passphrase",
  expiresAt: 0,
  iterations: 600_000,
});
```

**Key generation & password analysis (same engine as `zefer keygen` / `zefer analyze`):**

```ts
import { generateWithOptions, generateValue, analyzePassword, MODES } from "zefer-cli";

const key   = generateWithOptions("base58", 24, { groupSize: 6, excludeAmbiguous: true });
const uuid  = generateValue("uuid", 0);
const score = analyzePassword(key).score;   // 0–4
```

> **Lambda / microservice notes**
> - `encodeZefer`/`decodeZefer` work in-memory (AES runs in 16 MB chunks, but the
>   full input/output stays in RAM). Peak ≈ input + output size — size your
>   function ≥ 512 MB for ~100 MB payloads.
> - Always pass an explicit `iterations` (default `600_000`). The `-i 0`
>   auto-benchmark is a CLI-only convenience and is **not** in the library path,
>   so there is no cold-start PBKDF2 calibration.

Full API reference, every exported function and type, and advanced examples:
**[docs/LIBRARY.md](docs/LIBRARY.md)**

---

## Security Options

All security metadata is stored **inside the encrypted payload** — invisible to anyone without the passphrase.

| Option | Flag | Description |
|---|---|---|
| Expiration | `--ttl <minutes>` | File becomes undecryptable after N minutes |
| Max attempts | `--max-attempts <n>` | Blocks after N failed attempts (tracked at `~/.zefer/attempts.json`) |
| Secret question | `-q` + `-a` | Extra authentication, answer hashed with PBKDF2 (100k iterations) |
| IP allowlist | `--allowed-ips` | Restrict decryption to specific IPs |
| Dual key | `--dual-key` + `-2` | Requires two separate passphrases |
| Reveal key | `--reveal` | Creates a second encrypted block — share without exposing main passphrase |
| Public hint | `--hint` | Visible without passphrase — helps the recipient remember |
| Public note | `--note` | Public message — visible without passphrase |

## Scripting & Automation

zefer-cli is designed to be scriptable. Passphrase via flag, output to stdout, pipe-friendly:

```bash
# Encrypt all .env files in a directory
for f in *.env; do
  zefer encrypt "$f" -p "$ZEFER_PASS" -o "encrypted/$f.zefer"
done

# Decrypt and pipe to another command
zefer decrypt secrets.zefer -p "$ZEFER_PASS" | jq '.api_key'

# CI/CD: encrypt a secret file before committing
zefer encrypt .env.production \
  -p "$CI_ENCRYPT_PASS" \
  --ttl 10080 \
  -o .env.production.zefer

# Non-interactive password via environment
ZEFER_PASS="$(cat ~/.zefer_passphrase)"
zefer decrypt backup.zefer -p "$ZEFER_PASS" -o backup.tar.gz
```

### Environment variables

| Variable | Effect |
|---|---|
| `ZEFER_ASCII=1` | Force ASCII output (no Unicode spinner/blocks) |
| `ZEFER_UNICODE=1` | Force Unicode output |
| `NO_COLOR=1` | Disable all color output (standard) |

## Cross-platform Support

| Platform | Terminal | Mode |
|---|---|---|
| Linux | Any TTY | Unicode + raw mode |
| macOS | Terminal.app, iTerm2 | Unicode + raw mode |
| Windows | Windows Terminal, VS Code | Unicode + raw mode |
| Windows | PowerShell 5 | Unicode + muted readline |
| Windows | cmd.exe / conhost | ASCII fallback + muted readline |
| All | Piped / non-TTY | Silent (no spinner), reads passphrase from stdin |
| All | `CI=true` | ASCII fallback, no spinner |

Password input is always hidden — either via `setRawMode` (Unix/Windows Terminal) or readline output muting (legacy Windows).

## Tech Stack

| Layer | Technology |
|---|---|
| CLI framework | [Ink 5](https://github.com/vadimdemedes/ink) (React 18 for the terminal) |
| Argument parsing | [Commander 12](https://github.com/tj/commander.js) |
| Language | [TypeScript 5](https://www.typescriptlang.org/) |
| Encryption | Node.js `crypto` module (AES-256-GCM) |
| Key derivation | PBKDF2-SHA256 via `crypto.pbkdf2` (async, libuv thread pool) |
| Compression | Node.js `zlib` module (gzip, deflate, deflate-raw) |
| Colors | [chalk 5](https://github.com/chalk/chalk) |
| Build | [tsup](https://tsup.egoist.dev/) (ESM bundle, 50 KB) |
| Runtime | Node.js 20+ |

## Project Structure

```
src/
  index.ts            # CLI channel — Commander setup + command wiring (→ bin)
  lib.ts              # Library channel — programmatic entry (re-exports src/lib/*)
  mcp/
    server.ts         # MCP channel — stdio JSON-RPC server
  commands/
    encrypt.tsx       # Encrypt command — Ink UI + file I/O
    decrypt.tsx       # Decrypt command — Ink UI + all security checks
    keygen.tsx        # Key generator — 7 modes
    analyze.tsx       # Password security report
    info.tsx          # Public header viewer
  lib/
    crypto.ts         # AES-256-GCM + PBKDF2 — Node.js port of zefer/app/lib/crypto.ts
    chunked-crypto.ts # 16 MB chunked encryption — Node.js port
    compression.ts    # Gzip/Deflate — Node.js zlib port
    zefer.ts          # ZEFB3/ZEFR3 format encode/decode — Node.js port
    progress.ts       # Real-time progress tracking (same stage weights as web)
    passwords.ts      # CSPRNG key generation (7 modes) + password analysis
    attempts.ts       # Attempt counter (~/.zefer/attempts.json)
  ui/
    Header.tsx        # CLI header component
    ProgressBar.tsx   # ASCII / Unicode progress bar
    Spinner.tsx       # Braille / ASCII spinner
    StatusLine.tsx    # Combined status + progress
  utils/
    format.ts         # File sizes, dates, durations
    prompt.ts         # Password input (cross-platform)
    terminal.ts       # Unicode / ASCII capability detection
dist/
  index.js            # CLI/MCP bundle (ESM, includes shebang) — the bin
  lib.js / lib.cjs    # Library bundles (ESM + CommonJS)
  lib.d.ts / lib.d.cts# TypeScript declarations
docs/
  ARCHITECTURE.md     # Technical deep-dive
  CONTRIBUTING.md     # Development setup + conventions
  LIBRARY.md          # Programmatic library / SDK reference
  MCP.md              # MCP integration guide
  SECURITY.md         # Threat model + cryptographic details
  RELEASING.md        # npm token setup, GitHub Actions, version workflow
```

## Security Model

1. All encryption/decryption is done locally — no network requests, no servers
2. PBKDF2 runs in the libuv thread pool (non-blocking, Ink UI stays responsive)
3. Each file has a unique random salt and IV — no two encryptions are identical
4. AES-GCM auth tag verifies ciphertext integrity before decryption
5. Secret question answer is normalized (trim + lowercase) and hashed with PBKDF2 (100k iterations)
6. IP restriction, expiration, and attempt limit are inside the encrypted payload — invisible without the key
7. Timing attack mitigation: minimum 100ms response on wrong passphrase
8. Attempt counter is file-specific (keyed by first 40 bytes of ciphertext) and stored at `~/.zefer/attempts.json`

| Primitive | Algorithm | Parameters |
|---|---|---|
| Symmetric encryption | AES-256-GCM | 256-bit key, 96-bit IV, 128-bit auth tag |
| Key derivation | PBKDF2-SHA256 | 300k / 600k / 1M iterations, 256-bit salt |
| Answer hashing | PBKDF2-SHA256 | 100,000 iterations |
| Random generation | `crypto.randomBytes` | OS-level CSPRNG |

For the full threat model, see [docs/SECURITY.md](docs/SECURITY.md).

## Contributing

Contributions are welcome. Please read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first.

```bash
git clone https://github.com/carrilloapps/zefer-cli.git
cd zefer-cli
npm install
npm run dev          # Run directly with tsx (no build step)
npm run build        # Compile to dist/
npm run typecheck    # TypeScript type check
```

## Author

<a href="https://github.com/carrilloapps">
<img src="https://github.com/carrilloapps.png" width="80" height="80" alt="Jose Carrillo" style="border-radius: 50%;" />
</a>

**Jose Carrillo** — Senior Fullstack Developer & Tech Lead

10+ years building scalable, efficient, and secure software. Based in Colombia.

<p>
<a href="https://github.com/carrilloapps"><img src="https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub" /></a>
<a href="https://carrillo.app"><img src="https://img.shields.io/badge/Website-carrillo.app-22c55e?style=flat-square&logo=googlechrome&logoColor=white" alt="Website" /></a>
<a href="https://linkedin.com/in/carrilloapps"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
<a href="https://x.com/carrilloapps"><img src="https://img.shields.io/badge/X-000000?style=flat-square&logo=x&logoColor=white" alt="X" /></a>
<a href="https://dev.to/carrilloapps"><img src="https://img.shields.io/badge/Dev.to-0A0A0A?style=flat-square&logo=devdotto&logoColor=white" alt="Dev.to" /></a>
<a href="https://medium.com/@carrilloapps"><img src="https://img.shields.io/badge/Medium-000000?style=flat-square&logo=medium&logoColor=white" alt="Medium" /></a>
<a href="https://stackoverflow.com/users/14580648"><img src="https://img.shields.io/badge/Stack%20Overflow-F58025?style=flat-square&logo=stackoverflow&logoColor=white" alt="Stack Overflow" /></a>
</p>

## Support

If you find zefer-cli useful, consider supporting the project:

<p>
<a href="https://www.buymeacoffee.com/carrilloapps"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?style=flat-square&logo=buymeacoffee&logoColor=000" alt="Buy Me a Coffee" /></a>
<a href="https://github.com/sponsors/carrilloapps"><img src="https://img.shields.io/badge/GitHub%20Sponsors-EA4AAA?style=flat-square&logo=githubsponsors&logoColor=white" alt="GitHub Sponsors" /></a>
<a href="https://github.com/carrilloapps/zefer-cli/stargazers"><img src="https://img.shields.io/github/stars/carrilloapps/zefer-cli?style=social" alt="Star on GitHub" /></a>
</p>

## License

[MIT](LICENSE) &copy; 2026 [Jose Carrillo](https://carrillo.app)

---

<div align="center">
<sub>Built with security in mind, from Colombia to the world.</sub>
</div>
