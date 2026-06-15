# zefer-cli — Library (programmatic API)

`zefer-cli` is three channels over one core:

| Channel | Entry | Use it for |
|---|---|---|
| **CLI** | `zefer …` (bin) | Humans & shell scripts |
| **MCP server** | `zefer mcp` | AI agents (Claude, Cursor, …) — see [MCP.md](MCP.md) |
| **Library** | `import "zefer-cli"` | Your own Node.js code, services, AWS Lambda |

All three produce byte-for-byte compatible `.zefer` files, fully decryptable in
the web app at [zefer.carrillo.app](https://zefer.carrillo.app) and vice-versa.

The library entry (`src/lib.ts` → `dist/lib.js` / `dist/lib.cjs`) contains **no
Ink, no React, no Commander and no `process.argv` parsing** — importing it has
zero side effects, so it is safe in any Node 20+ runtime.

---

## Install

```bash
npm install zefer-cli
```

## Import

```ts
// ESM / TypeScript
import { encodeZefer, decodeZefer } from "zefer-cli";

// CommonJS
const { encodeZefer, decodeZefer } = require("zefer-cli");
```

Ships ESM (`dist/lib.js`) and CommonJS (`dist/lib.cjs`) builds with full
TypeScript declarations (`dist/lib.d.ts` / `dist/lib.d.cts`).

> The package `bin` (`zefer` / `zefer-cli`) is unchanged and independent — the
> library is the package's default import; the CLI is reached through the bin.

---

## Quick start

```ts
import { encodeZefer, decodeZefer } from "zefer-cli";
import { readFile, writeFile } from "node:fs/promises";

// ── Encrypt text ──────────────────────────────────────────────
const buf = await encodeZefer({
  content: "api_key=abc123",
  passphrase: "a-strong-passphrase",
  fileName: null,
  expiresAt: 0,            // 0 = never; otherwise a Unix-ms timestamp
  compression: "gzip",     // "none" | "gzip" | "deflate" | "deflate-raw"
  iterations: 600_000,     // explicit — see "Iterations" below
});
await writeFile("secret.zefer", buf);

// ── Decrypt ───────────────────────────────────────────────────
const bytes = await readFile("secret.zefer");
const res = await decodeZefer(bytes.toString("utf-8"), "a-strong-passphrase", {
  rawBytes: bytes,         // required for ZEFB3/ZEFR3 binary files
});

if (res.ok) {
  console.log(res.payload.content);   // text mode → string
  // res.payload.fileData              // file mode → Buffer
  // res.payload.meta                  // ZeferMeta (createdAt, expiresAt, …)
} else {
  console.error(res.error);           // "wrong_passphrase" | "expired" | …
}
```

### Encrypt a file (file mode)

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

### Inspect the public header without decrypting

```ts
import { parseFile } from "zefer-cli";

const bytes = await readFile("secret.zefer");
const parsed = parseFile(bytes.toString("utf-8"), bytes);
if (parsed) {
  console.log(parsed.header.mode);        // "text" | "file"
  console.log(parsed.header.iterations);  // KDF strength
  console.log(parsed.header.hint);        // public hint (if any)
}
```

---

## Security layers

Everything the CLI/MCP support is available here. Each lives **inside the
encrypted payload** (`ZeferMeta`), invisible without the passphrase.

```ts
const buf = await encodeZefer({
  content: "top secret",
  passphrase: "primary-pass",
  fileName: null,
  expiresAt: Date.now() + 60 * 60_000,      // expires in 60 minutes

  // Dual passphrase — two-person authorization
  secondPassphrase: "second-pass",
  dualKey: true,

  // Reveal key — recipients decrypt without the main passphrase (→ ZEFR3)
  revealKey: "share-this-key",

  // Secret question (answer is PBKDF2-hashed)
  question: "Project codename?",
  questionAnswer: "bluebird",

  // Public, unencrypted metadata
  hint: "rotate quarterly",
  note: "owned by platform team",

  maxAttempts: 5,                            // 0 = unlimited
  allowedIps: ["203.0.113.4", "2001:db8::1"],
  iterations: 1_000_000,
});
```

Decrypting a protected file:

```ts
const res = await decodeZefer(bytes.toString("utf-8"), "primary-pass", {
  rawBytes: bytes,
  secondPassphrase: "second-pass",  // for dual-key files
  questionAnswer: "bluebird",       // if the file has a secret question
});
```

---

## Key generation & password analysis

The same engine behind `zefer keygen` and `zefer analyze` (in `src/lib/passwords.ts`):

```ts
import {
  generateValue, generateWithOptions, MODES, CHARSETS,
  analyzePassword, crackBucketFor, complianceOf, ATTACK_SCENARIOS,
} from "zefer-cli";

// 7 modes: unicode | secure | alpha | hex | base58 | pin | uuid
generateValue("secure", 64);
generateValue("uuid", 0);                                  // UUID v7 (length ignored)

generateWithOptions("base58", 24, {
  excludeAmbiguous: true,    // drop 0 O 1 l I
  excludeChars: "/\\",
  requireAllClasses: true,   // guarantee lower/upper/digit/symbol when available
  noRepeats: true,           // never the same char twice in a row
  groupSize: 6,              // cosmetic dashes every 6 chars
});

const a = analyzePassword("Tr0ub4dor&3");
a.score;            // 0–4 (very weak → strong)
a.effectiveBits;    // entropy after structural penalties
a.warnings;         // ["common", "sequence", …]
```

---

## Low-level primitives

For custom pipelines (e.g. envelope encryption, your own container format):

```ts
import {
  // string helpers (base64 envelope: "salt.iv.ciphertext")
  encrypt, decrypt, encryptBytesToBase64, decryptFromBase64,
  // raw buffers
  encryptRaw, decryptFromBinary,
  // chunked (16 MB) — constant active memory per chunk
  chunkedEncrypt, chunkedDecryptToBuffer, CHUNK_SIZE,
  // KDF & dual-key
  deriveKey, combineDualKeys, hashAnswer, benchmarkDevice,
  // compression
  compressBytes, decompressBytes, smartCompress,
} from "zefer-cli";

const token = await encrypt("hello", "pass", 600_000);     // → "salt.iv.ct"
const back  = await decrypt(token, "pass", 600_000);       // → "hello"
```

---

## API reference

### `encodeZefer(options): Promise<Buffer>`

Encrypts `content` (text) **or** `fileData` (file) into the `.zefer` binary
format. Returns the full file as a `Buffer`.

`EncodeOptions` (key fields):

| Field | Type | Notes |
|---|---|---|
| `content` | `string?` | Text mode payload |
| `fileData` | `Buffer?` | File mode payload (takes precedence) |
| `passphrase` | `string` | **Required** |
| `fileName` | `string \| null` | **Required** (use `null` for text mode) |
| `expiresAt` | `number` | **Required**. Unix ms, `0` = never |
| `fileType` | `string?` | MIME type (file mode) |
| `iterations` | `number?` | PBKDF2 rounds, default `600_000` |
| `compression` | `"none"\|"gzip"\|"deflate"\|"deflate-raw"?` | default `"none"` |
| `secondPassphrase`, `dualKey` | dual-key (two-person) | |
| `revealKey` | `string?` | produces a ZEFR3 dual-block file |
| `question`, `questionAnswer` | secret question | |
| `hint`, `note` | public (unencrypted) metadata | |
| `maxAttempts` | `number?` | `0` = unlimited |
| `allowedIps` | `string[]?` | IPv4/IPv6 allowlist |
| `onProgress` | callbacks | optional progress hooks |

### `decodeZefer(fileContent, passphrase, options?): Promise<DecodeResult>`

```ts
type DecodeResult =
  | { ok: true;  payload: ZeferPayload; header: ZeferHeader }
  | { ok: false; error: DecodeError };

type DecodeError =
  | "invalid_format" | "wrong_passphrase" | "expired"
  | "wrong_answer"   | "max_attempts"     | "ip_blocked" | "needs_answer";
```

Pass binary bytes via `options.rawBytes`. `options` also accepts
`secondPassphrase`, `questionAnswer`, `onProgress` and `maxDecompressSize`.

`maxDecompressSize` is a decompression-bomb safety cap, in bytes, that applies
to the **library channel only** and defaults to **512 MB**. It guards services
that decrypt untrusted, attacker-supplied input. Pass `0` to disable it (the CLI
and MCP channels do exactly this, since they operate on local, trusted files).

### `parseFile(fileContent, rawBytes?): ParsedFile | null`

Reads the public header (and locates the encrypted blocks) **without
decrypting**. Returns `null` if the bytes are not a recognized `.zefer` file.

### Full export list

- **Format:** `encodeZefer`, `decodeZefer`, `parseFile` + types `ZeferHeader`,
  `ZeferMeta`, `ZeferPayload`, `EncodeOptions`, `DecodeResult`, `DecodeError`,
  `ParsedFile`
- **Crypto primitives:** `encrypt`, `decrypt`, `encryptBytesToBase64`,
  `decryptFromBase64`, `encryptRaw`, `decryptFromBinary`, `deriveKey`,
  `combineDualKeys`, `hashAnswer`, `benchmarkDevice`, `toBase64`, `fromBase64`,
  `encodeText`, `decodeBytes`
- **Chunked:** `chunkedEncrypt`, `chunkedDecryptToBuffer`, `CHUNK_SIZE`,
  `ChunkedEncryptResult`
- **Compression:** `compressBytes`, `decompressBytes`, `smartCompress`,
  `CompressionMethod`
- **Keygen / analysis:** `generateValue`, `generateWithOptions`, `entropyOf`,
  `charsetFor`, `MODES`, `CHARSETS`, `DEFAULT_GENERATE_OPTIONS`,
  `analyzePassword`, `bucketCrackTime`, `crackBucketFor`, `toSuperscript`,
  `complianceOf`, `keyspaceExponent`, `ATTACK_SCENARIOS`, `AVERAGE_HUMAN_BITS`
  + types `KeygenMode`, `GenerateOptions`, `PasswordAnalysis`, `PasswordWarning`,
  `CrackSpeed`, `CrackBucket`, `ScenarioKey`, `ComplianceCheck`
- **Attempt counter:** `getAttempts`, `setAttempts`, `removeAttempts`

---

## Operational notes (Lambda / microservices)

**Memory.** `encodeZefer`/`decodeZefer` operate in-memory. AES runs in 16 MB
chunks (constant active memory) but the full input and output are held in RAM,
so peak ≈ input + output size. For ~100 MB payloads, give the function
**≥ 512 MB**. (A true streaming `Transform` API with constant memory is a
possible future addition — open an issue if you need it.)

**Iterations.** Always pass an explicit `iterations` (default `600_000`). The
`-i 0` auto-benchmark is a **CLI-only** convenience and is *not* part of the
library path, so there is no per-invocation PBKDF2 calibration cost on cold
start.

**Attempt counter.** When a file sets `maxAttempts`, `decodeZefer` reads/writes
`~/.zefer/attempts.json`. On read-only or ephemeral filesystems this is a
non-fatal no-op (write failures are swallowed).

**No network, no telemetry.** Everything runs locally; passphrases never leave
the process.

---

## Cross-channel compatibility

A file produced by any channel decrypts in every other:

```ts
// File written by `zefer encrypt secret.txt -p pass` (CLI)
const bytes = await readFile("secret.txt.zefer");
const res = await decodeZefer(bytes.toString("utf-8"), "pass", { rawBytes: bytes });
// res.payload.fileData → original bytes
```

The smoke-test suite (`npm test`) asserts this round-trip across CLI ⇄ library
and ESM ⇄ CJS on every build.
