<div align="center">

<img src="https://raw.githubusercontent.com/carrilloapps/zefer/main/app/icon.svg" alt="Zefer" width="80" height="80" />

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
- Pipe-friendly: `stdin` / `stdout` support
- Non-interactive mode for CI/CD scripts
- Real-time progress bar with Ink (React CLI)
- Cross-platform: Linux, macOS, Windows
- ASCII fallback for `cmd.exe` and legacy terminals
- `--verbose` for detailed operation info

</td>
<td width="50%">

**Key Generator**
- 5 modes: `alpha`, `hex`, `uuid`, `secure`, `unicode`
- Configurable length (default: 64 characters)
- Generate multiple keys at once (`--count`)
- Rejection sampling — no modulo bias
- OS-level CSPRNG via `crypto.randomBytes`

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

### Install

```bash
npm install -g zefer-cli
```

The installed command is **`zefer`** (short, no suffix):

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

### From source

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
  -m, --mode <mode>   alpha | hex | uuid | secure | unicode  (default: secure)
  -l, --length <n>    Length in characters  (default: 64)
  -n, --count <n>     Number of keys to generate  (default: 1)
```

| Mode | Character set | Best for |
|---|---|---|
| `secure` | Base64url (`A-Z a-z 0-9 - _`) | General passphrases |
| `alpha` | Printable ASCII + symbols | High-entropy passphrases |
| `hex` | `0-9 a-f` | Tokens, hashes |
| `uuid` | UUID v4 format | Unique identifiers |
| `unicode` | Latin, Cyrillic, Arabic, CJK, Emoji | Maximum entropy |

**Examples:**

```bash
zefer keygen                        # 64-char secure key
zefer keygen -m hex -l 32           # 32-char hex token
zefer keygen -m alpha -l 128        # 128-char printable ASCII
zefer keygen -m uuid                # UUID v4
zefer keygen -m unicode -l 24       # 24 Unicode characters
zefer keygen -n 5 -l 32             # 5 keys at once
```

---

### `zefer info`

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
  commands/
    encrypt.tsx       # Encrypt command — Ink UI + file I/O
    decrypt.tsx       # Decrypt command — Ink UI + all security checks
    keygen.tsx        # Key generator — 5 modes
    info.tsx          # Public header viewer
  lib/
    crypto.ts         # AES-256-GCM + PBKDF2 — Node.js port of zefer/app/lib/crypto.ts
    chunked-crypto.ts # 16 MB chunked encryption — Node.js port
    compression.ts    # Gzip/Deflate — Node.js zlib port
    zefer.ts          # ZEFB3/ZEFR3 format encode/decode — Node.js port
    progress.ts       # Real-time progress tracking (same stage weights as web)
    keygen.ts         # CSPRNG key generation (5 modes)
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
  index.ts            # Commander setup + command wiring
dist/
  index.js            # Compiled ESM bundle (50 KB, includes shebang)
docs/
  ARCHITECTURE.md     # Technical deep-dive
  CONTRIBUTING.md     # Development setup + conventions
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
