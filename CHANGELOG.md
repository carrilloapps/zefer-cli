# Changelog

All notable changes to zefer-cli will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
