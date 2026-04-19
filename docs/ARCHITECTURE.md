# Architecture

> [README](../README.md) · **Architecture** · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

This document covers the internal structure, data flow, and design decisions of zefer-cli.

## Relationship to the Web App

zefer-cli is a Node.js port of the core cryptographic libraries from [zefer](https://github.com/carrilloapps/zefer). The following files were ported from `app/lib/` to `src/lib/`:

| Web App | CLI | Change |
|---|---|---|
| `app/lib/crypto.ts` | `src/lib/crypto.ts` | `crypto.subtle` → `node:crypto` (pbkdf2, createCipheriv) |
| `app/lib/chunked-crypto.ts` | `src/lib/chunked-crypto.ts` | Same algorithm, `Buffer` instead of `ArrayBuffer` |
| `app/lib/compression.ts` | `src/lib/compression.ts` | `CompressionStream` → `node:zlib` |
| `app/lib/zefer.ts` | `src/lib/zefer.ts` | `Blob` → `Buffer`, `localStorage` → `~/.zefer/attempts.json` |
| `app/lib/progress.ts` | `src/lib/progress.ts` | Identical logic, extra `reading` and `writing` stages |

The binary output is **byte-for-byte identical** — files are cross-compatible between CLI and browser.

## Data Flow

### Encryption

```
Input (file / text / stdin)
  │
  ├── Read into Buffer
  ├── Compress (gzip/deflate/none)
  ├── Pack:  [4-byte meta length][meta JSON][data bytes]
  │                                │
  │                         ZeferMeta (encrypted):
  │                           fileName, fileType, fileSize
  │                           expiresAt, createdAt
  │                           answerHash (PBKDF2, 100k iter)
  │                           allowedIps, question, maxAttempts
  │
  ├── PBKDF2-SHA256(passphrase, random salt, N iterations) → 256-bit key
  │     └── Runs in libuv thread pool (non-blocking)
  │
  ├── For each 16 MB chunk:
  │     ├── IV = baseIv XOR chunkIndex (last 4 bytes)
  │     └── AES-256-GCM(key, IV, chunk) → ciphertext || 16-byte auth tag
  │
  ├── [Optional] Reveal key: same payload, independent PBKDF2 + AES
  │
  └── Assemble ZEFB3 or ZEFR3 binary:
        [magic][headerLen][header JSON]
        [salt][baseIv][chunk1][chunk2]...
        (ZEFR3 adds: [mainBlockSize][mainBlock][revealBlock])
```

### Decryption

```
Input (.zefer file / stdin)
  │
  ├── Parse magic bytes → detect ZEFB3 / ZEFR3 / ZEFER3 / ZEFER2
  ├── Extract public header (iterations, compression, hint, note, mode)
  │
  ├── For each passphrase candidate (passphrase, combineDualKeys):
  │     ├── PBKDF2-SHA256(candidate, salt, iterations) → key
  │     └── For each chunk: AES-256-GCM decrypt → verify auth tag
  │
  ├── If wrong passphrase: wait ≥100ms (timing attack mitigation)
  │
  ├── Extract ZeferMeta from decrypted payload
  │
  ├── Security checks (in order):
  │     ├── maxAttempts: read ~/.zefer/attempts.json, reject if over limit
  │     ├── answerHash: PBKDF2-hash(answer) == stored hash?
  │     ├── expiresAt: Date.now() > expiresAt?
  │     └── (IP check is in the web app; CLI skips — no automatic IP detection)
  │
  ├── Clear attempt counter on success
  ├── Decompress (gzip/deflate/none)
  │
  └── Output:
        text mode → stdout (or -o file)
        file mode → original filename (or -o path)
```

## Binary Format

### ZEFB3

```
Offset  Size   Field
──────  ─────  ─────────────────────────────────
0       5      Magic: 0x5A 0x45 0x46 0x42 0x33 ("ZEFB3")
5       4      Header JSON length (big-endian uint32)
9       N      Header JSON (UTF-8)
9+N     32     Salt (random)
9+N+32  12     Base IV (random)
9+N+44  var    Encrypted chunks:
                 Per chunk: [4-byte length][ciphertext || 16-byte auth tag]
```

### ZEFR3

```
Offset      Size   Field
──────────  ─────  ─────────────────────────────────────────
0           5      Magic: 0x5A 0x45 0x46 0x52 0x33 ("ZEFR3")
5           4      Header JSON length
9           N      Header JSON (UTF-8)
9+N         4      Main block size (big-endian uint32)
9+N+4       M      Main block: [salt 32][baseIv 12][chunks...]
9+N+4+M     var    Reveal block: [salt 32][baseIv 12][chunks...]
```

### Encrypted Payload (inside each block)

```
[4-byte meta length (big-endian)][meta JSON (UTF-8)][data bytes]
```

Where `data bytes` is either raw content (text mode) or file bytes (file mode), optionally gzip/deflate compressed.

## Chunk IV Derivation

Each chunk uses a unique IV to prevent nonce reuse across chunks:

```
chunkIv(baseIv, index) = baseIv with last 4 bytes XOR'd with index
```

Implemented with `>>> 0` to keep the XOR result as an unsigned 32-bit integer (JavaScript bitwise XOR produces signed results for values ≥ 2^31).

## Key Derivation

PBKDF2 runs via `crypto.pbkdf2` (promisified), which executes in Node.js's libuv thread pool. This means the event loop stays unblocked during the 300k–1M iteration derivation, allowing the Ink UI to continue rendering the animated spinner and progress bar.

## Progress Tracking

Stages and their weight in the overall percentage:

| Stage | Range | Trigger |
|---|---|---|
| Reading | 0–5% | File I/O start |
| Compressing | 5–15% | Compression start/end |
| Deriving | 15–20% | PBKDF2 start/done |
| Encrypting | 20–95% | Per-chunk callback |
| Packaging | 95–98% | Buffer assembly |
| Writing | 98–100% | File write |
| Done | 100% | Exit |

Decryption mirrors this with: Reading → Deriving → Decrypting → Decompressing → Verifying → Writing.

## Terminal Detection

`src/utils/terminal.ts` detects Unicode support at startup:

1. `ZEFER_ASCII=1` → ASCII always
2. `ZEFER_UNICODE=1` → Unicode always
3. `TERM=dumb` or `CI=true` → ASCII
4. Windows without `WT_SESSION` (Windows Terminal) or `TERM_PROGRAM=vscode` → ASCII
5. Everything else → Unicode

## Password Input

`src/utils/prompt.ts` uses three strategies depending on the environment:

1. **Not a TTY** (piped) — reads from stdin stream
2. **TTY with `setRawMode`** (Linux, macOS, Windows Terminal, PowerShell 7+) — raw mode with `*` masking per character, handles Backspace and Ctrl-C
3. **TTY without `setRawMode`** (cmd.exe, Git Bash without PTY) — readline with `_writeToOutput` monkey-patched to suppress echo

## Attempt Tracking

The web app uses `localStorage` to track failed decryption attempts per file. The CLI uses `~/.zefer/attempts.json`:

```json
{
  "abc123def456...": 2
}
```

Keys are the first 40 characters of the first encrypted line (text format) or the string `"bin"` prefix (binary format). On success, the key is removed. On reaching `maxAttempts`, decryption is rejected before any crypto work is done.
