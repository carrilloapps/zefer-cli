/**
 * zefer-cli — programmatic library entry point.
 *
 * This module exposes the full zefer core as an importable library, in parity
 * with the CLI and the MCP server. It contains ZERO terminal UI: no Ink, no
 * React, no Commander, no process.argv parsing and no side effects on import —
 * so it is safe to `import` (ESM) or `require` (CJS) from any Node 20+ service,
 * including AWS Lambda and microservices.
 *
 * The three channels share the exact same core, so files are byte-for-byte
 * compatible across the CLI, the MCP server, the library and the web app
 * (https://zefer.carrillo.app).
 *
 * ── Quick start ──────────────────────────────────────────────────────────
 *
 *   import { encodeZefer, decodeZefer } from "zefer-cli";
 *
 *   // Encrypt text into the .zefer binary format (ZEFB3)
 *   const buf = await encodeZefer({
 *     content: "api_key=123",
 *     passphrase: "a-strong-passphrase",
 *     fileName: null,
 *     expiresAt: 0,            // 0 = never
 *     compression: "gzip",
 *     iterations: 600_000,     // explicit — the library never auto-benchmarks
 *   });
 *
 *   // Decrypt back. `fileContent` is only used for legacy text formats; for
 *   // ZEFB3/ZEFR3 binary files, pass the bytes via `rawBytes`.
 *   const res = await decodeZefer(buf.toString("utf-8"), "a-strong-passphrase", {
 *     rawBytes: buf,
 *   });
 *   if (res.ok) console.log(res.payload.content);
 *
 * ── Operational notes ────────────────────────────────────────────────────
 *
 * • Memory: `encodeZefer`/`decodeZefer` operate in-memory. AES runs in 16 MB
 *   chunks (constant active memory) but the full input and output are held in
 *   RAM, so peak usage ≈ input + output size. Size your Lambda/container
 *   accordingly (≥ 512 MB is comfortable for ~100 MB payloads).
 *
 * • Iterations: always pass an explicit `iterations` value (default 600_000).
 *   The auto-benchmark (`-i 0`) behaviour is a CLI-only convenience and is not
 *   part of the library path, so there is no cold-start PBKDF2 calibration.
 *
 * • Attempt counting: when a file sets `maxAttempts`, `decodeZefer` reads/writes
 *   a counter at `~/.zefer/attempts.json` (see the attempt helpers below). On
 *   read-only/ephemeral filesystems this is a non-fatal no-op.
 */

// ── Binary format encode/decode (ZEFB3 / ZEFR3 + legacy read) ──
export * from "./lib/zefer.js";

// ── Low-level AES-256-GCM + PBKDF2 primitives ──
export * from "./lib/crypto.js";

// ── Chunked (16 MB) AES-256-GCM for large payloads ──
export * from "./lib/chunked-crypto.js";

// ── Compression (gzip / deflate / deflate-raw) ──
export * from "./lib/compression.js";

// ── Key generation, password strength analysis & crack-time modelling ──
export * from "./lib/passwords.js";

// ── Decryption attempt counter (~/.zefer/attempts.json) ──
export * from "./lib/attempts.js";
