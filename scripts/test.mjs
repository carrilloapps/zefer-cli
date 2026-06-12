#!/usr/bin/env node
/**
 * Smoke + integration test suite for zefer-cli — validates ALL THREE CHANNELS.
 *
 *   CLI      — every command and the 7 keygen modes + security layers
 *   MCP      — the stdio JSON-RPC server and its 5 tools
 *   Library  — ESM + CJS programmatic API, primitives and security layers
 *   Cross    — a file encrypted in one channel decrypts in the other two
 *
 * Run with `npm test` (builds first). Any red line is a real regression.
 */

import { execSync, spawn } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ─── Helpers ───

const BIN = "node dist/index.js";
let passed = 0;
let failed = 0;

function run(args, opts = {}) {
  try {
    const out = execSync(`${BIN} ${args}`, { encoding: "utf-8", stdio: "pipe", ...opts });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: e.stdout ?? "", err: e.stderr ?? "", code: e.status };
  }
}

function assert(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓  ${name}`);
    passed++;
  } else {
    console.error(`  ✗  ${name}${detail ? `\n     ${detail}` : ""}`);
    failed++;
  }
}

// Temp files
const tmp    = tmpdir();
const txtIn  = join(tmp, "zefer_smoke_in.txt");
const txtOut = join(tmp, "zefer_smoke_out.txt");
const zef    = join(tmp, "zefer_smoke.zefer");
const zef2   = join(tmp, "zefer_smoke2.zefer");

const PASS    = "smoke-test-pass-42";
const CONTENT = "zefer smoke test content — special chars: áéíóú 日本語 🔐";

writeFileSync(txtIn, CONTENT, "utf-8");

// ─── Ensure build is fresh ───

console.log("\n  Building...");
try {
  execSync("npm run build", { stdio: "pipe" });
  console.log("  build OK\n");
} catch (e) {
  console.error("  build failed — aborting\n");
  process.exit(1);
}

// ─── Tests ───

console.log("  Running smoke tests\n");

// 1. --version
const ver = run("--version");
assert("--version exits 0",        ver.ok);
assert("--version prints version", ver.out.trim().match(/^\d+\.\d+\.\d+/) !== null);

// 2. --help
const help = run("--help");
assert("--help exits 0",           help.ok);
assert("--help mentions encrypt",  help.out.includes("encrypt"));
assert("--help mentions decrypt",  help.out.includes("decrypt"));
assert("--help mentions keygen",   help.out.includes("keygen"));
assert("--help mentions info",     help.out.includes("info"));

// 3. keygen modes — all 7 (CLI validates against passwords.ts MODES)
for (const mode of ["unicode", "secure", "alpha", "hex", "base58", "pin", "uuid"]) {
  const kg = run(`keygen --mode ${mode} --length 32`);
  assert(`keygen --mode ${mode}`, kg.ok && kg.out.trim().length > 0, kg.err);
}
// keygen rejects an invalid mode
assert("keygen rejects invalid mode", !run("keygen --mode bogus").ok);
// keygen advanced options
const kgAdv = run("keygen --mode base58 --length 24 --group 6 --exclude-ambiguous --quiet");
assert("keygen advanced options (group/exclude/quiet)", kgAdv.ok && kgAdv.out.includes("-"));

// 4. keygen --count
const kgMulti = run("keygen --mode hex --length 16 --count 3");
assert("keygen --count 3 produces 3 lines", kgMulti.ok && kgMulti.out.split("\n").filter((l) => l.trim().match(/^[0-9a-f]{16}$/)).length === 3);

// 5. Encrypt text mode
const enc1 = run(`encrypt --text "${CONTENT}" -p "${PASS}" -o "${zef}"`);
assert("encrypt --text exits 0",      enc1.ok, enc1.err);
assert("encrypt produces .zefer file", existsSync(zef));

// 6. Decrypt text mode → stdout
const dec1 = run(`decrypt "${zef}" -p "${PASS}"`);
assert("decrypt text exits 0",         dec1.ok, dec1.err);
// stdout contains the Ink UI header + the decrypted content at the end
assert("decrypt text content matches", dec1.out.includes(CONTENT), `got: ${dec1.out.trim().slice(0, 80)}`);

// 7. Wrong passphrase → exit 1
const decBad = run(`decrypt "${zef}" -p "WRONG_PASS"`);
assert("wrong passphrase exits 1", !decBad.ok);

// 8. Encrypt file mode
const enc2 = run(`encrypt "${txtIn}" -p "${PASS}" -o "${zef2}"`);
assert("encrypt file exits 0",       enc2.ok, enc2.err);
assert("encrypt file produces .zefer", existsSync(zef2));

// 9. Decrypt file mode → explicit output
const dec2 = run(`decrypt "${zef2}" -p "${PASS}" -o "${txtOut}" --force`);
assert("decrypt file exits 0",            dec2.ok, dec2.err);
assert("decrypt file content matches",    existsSync(txtOut) && readFileSync(txtOut, "utf-8").trim() === CONTENT.trim());

// 10. info reads public header
const info = run(`info "${zef2}"`);
assert("info exits 0",            info.ok, info.err);
assert("info shows ZEFB3 format", info.out.includes("ZEFB3"));

// 11. Encrypt with gzip compression
const zefGzip = join(tmp, "zefer_gzip.zefer");
const decGzip = join(tmp, "zefer_gzip_dec.txt");
const encGzip = run(`encrypt "${txtIn}" -p "${PASS}" -c gzip -o "${zefGzip}"`);
const decGzipR = run(`decrypt "${zefGzip}" -p "${PASS}" -o "${decGzip}" --force`);
assert("encrypt + decrypt gzip round-trip",
  encGzip.ok && decGzipR.ok && existsSync(decGzip) && readFileSync(decGzip, "utf-8").trim() === CONTENT.trim());

// 12. Encrypt with hint and note → visible in info
const zefHint = join(tmp, "zefer_hint.zefer");
const encHint = run(`encrypt --text "secret" -p "${PASS}" --hint "my hint" --note "public note" -o "${zefHint}"`);
const infoHint = run(`info "${zefHint}"`);
assert("hint and note visible in info",
  encHint.ok && infoHint.ok && infoHint.out.includes("my hint") && infoHint.out.includes("public note"));

// ── Extra temp files for library + MCP + cross-channel ──
const libZefText = join(tmp, "zefer_lib_text.zefer");
const libZefFile = join(tmp, "zefer_lib_file.zefer");
const mcpZef     = join(tmp, "zefer_mcp.zefer");
const mcpFileOut = join(tmp, "zefer_mcp_fileout.txt");
const MCP_TEXT   = "mcp-channel-secret — 日本語 🔐";

// Load the library once, both module systems.
const ESM = await import("../dist/lib.js");
const CJS = require("../dist/lib.cjs");

// ── MCP helper: spawn the real stdio server, send JSON-RPC, collect replies ──
function mcpCall(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["dist/index.js", "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => {
      const msgs = out.split("\n").filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      resolve({ msgs, err });
    });
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
    child.stdin.end();
  });
}

console.log("\n  Library channel (ESM + CJS)\n");

// 13. Parity: both module systems expose the same working API
for (const [label, mod] of [["library (ESM)", ESM], ["library (CJS)", CJS]]) {
  // keygen — all 7 modes usable from the library
  assert(`${label} exposes 7 keygen modes`,
    mod.MODES.map((m) => m.key).join(",") === "unicode,secure,alpha,hex,base58,pin,uuid");
  for (const m of ["unicode", "secure", "alpha", "hex", "base58", "pin", "uuid"]) {
    const v = mod.generateValue(m, 24);
    assert(`${label} generateValue ${m}`, typeof v === "string" && v.length > 0);
  }
  const libKey = mod.generateWithOptions("base58", 24, { groupSize: 6, excludeAmbiguous: true });
  assert(`${label} generateWithOptions base58`, libKey.replace(/-/g, "").length === 24);
  assert(`${label} analyzePassword`, typeof mod.analyzePassword("Tr0ub4dor&3").score === "number");

  // encrypt → decrypt round-trip (ZEFB3)
  const libBuf = await mod.encodeZefer({
    content: CONTENT, passphrase: PASS, fileName: null, expiresAt: 0,
    compression: "gzip", iterations: 50_000,
  });
  assert(`${label} encodeZefer → ZEFB3 buffer`,
    Buffer.isBuffer(libBuf) && libBuf.subarray(0, 5).toString() === "ZEFB3");
  const libRes = await mod.decodeZefer(libBuf.toString("utf-8"), PASS, { rawBytes: libBuf });
  assert(`${label} decodeZefer round-trip`, libRes.ok && libRes.payload.content === CONTENT);
  assert(`${label} rejects wrong passphrase`,
    !(await mod.decodeZefer(libBuf.toString("utf-8"), "WRONG", { rawBytes: libBuf })).ok);
}

console.log("\n  Library — security layers\n");

// 14a. Dual-key (two-person authorization)
{
  const buf = await ESM.encodeZefer({
    content: CONTENT, passphrase: "primary", secondPassphrase: "second",
    dualKey: true, fileName: null, expiresAt: 0, iterations: 50_000,
  });
  const ok = await ESM.decodeZefer(buf.toString("utf-8"), "primary", { rawBytes: buf, secondPassphrase: "second" });
  assert("lib dual-key decodes with both passphrases", ok.ok && ok.payload.content === CONTENT);
  const half = await ESM.decodeZefer(buf.toString("utf-8"), "primary", { rawBytes: buf });
  assert("lib dual-key rejects single passphrase", !half.ok);
}

// 14b. Reveal key (ZEFR3 dual-block)
{
  const buf = await ESM.encodeZefer({
    content: CONTENT, passphrase: PASS, revealKey: "the-reveal-key",
    fileName: null, expiresAt: 0, iterations: 50_000,
  });
  assert("lib reveal key → ZEFR3 format", buf.subarray(0, 5).toString() === "ZEFR3");
  const viaMain = await ESM.decodeZefer(buf.toString("utf-8"), PASS, { rawBytes: buf });
  const viaReveal = await ESM.decodeZefer(buf.toString("utf-8"), "the-reveal-key", { rawBytes: buf });
  assert("lib ZEFR3 decodes with main passphrase", viaMain.ok && viaMain.payload.content === CONTENT);
  assert("lib ZEFR3 decodes with reveal key", viaReveal.ok && viaReveal.payload.content === CONTENT);
}

// 14c. Secret question
{
  const buf = await ESM.encodeZefer({
    content: CONTENT, passphrase: PASS, question: "codename?", questionAnswer: "BlueBird",
    fileName: null, expiresAt: 0, iterations: 50_000,
  });
  assert("lib secret question requires answer",
    (await ESM.decodeZefer(buf.toString("utf-8"), PASS, { rawBytes: buf })).error === "needs_answer");
  assert("lib secret question rejects wrong answer",
    (await ESM.decodeZefer(buf.toString("utf-8"), PASS, { rawBytes: buf, questionAnswer: "nope" })).error === "wrong_answer");
  const okAns = await ESM.decodeZefer(buf.toString("utf-8"), PASS, { rawBytes: buf, questionAnswer: "  bluebird " });
  assert("lib secret question accepts normalized answer", okAns.ok && okAns.payload.content === CONTENT);
}

// 14d. TTL expiration
{
  const buf = await ESM.encodeZefer({
    content: CONTENT, passphrase: PASS, fileName: null, expiresAt: 1, iterations: 50_000,
  });
  assert("lib expired file → expired",
    (await ESM.decodeZefer(buf.toString("utf-8"), PASS, { rawBytes: buf })).error === "expired");
}

// 14e. All compression methods round-trip
for (const method of ["none", "gzip", "deflate", "deflate-raw"]) {
  const buf = await ESM.encodeZefer({
    content: CONTENT, passphrase: PASS, fileName: null, expiresAt: 0, compression: method, iterations: 50_000,
  });
  const res = await ESM.decodeZefer(buf.toString("utf-8"), PASS, { rawBytes: buf });
  assert(`lib compression "${method}" round-trip`, res.ok && res.payload.content === CONTENT);
}

console.log("\n  Library — low-level primitives\n");

{
  const iters = 50_000;
  const data = Buffer.from("primitive payload — áé🔐", "utf-8");

  // string base64 envelope
  const token = await ESM.encrypt("hello-primitive", "p", iters);
  assert("lib encrypt/decrypt (string)", (await ESM.decrypt(token, "p", iters)) === "hello-primitive");

  // bytes → base64 → bytes
  const b64 = await ESM.encryptBytesToBase64(data, "p", iters);
  assert("lib encryptBytesToBase64/decryptFromBase64",
    (await ESM.decryptFromBase64(b64, "p", iters)).equals(data));

  // raw → binary
  const raw = await ESM.encryptRaw(data, "p", iters);
  const bin = Buffer.concat([raw.salt, raw.iv, raw.ciphertext]);
  assert("lib encryptRaw/decryptFromBinary", (await ESM.decryptFromBinary(bin, "p", iters)).equals(data));

  // chunked
  const big = Buffer.alloc(40_000, 7);
  const enc = await ESM.chunkedEncrypt(big, "p", iters);
  const dec = await ESM.chunkedDecryptToBuffer(Buffer.concat(enc.chunks), enc.salt, enc.baseIv, "p", iters);
  assert("lib chunkedEncrypt/chunkedDecryptToBuffer", dec.equals(big));
  assert("lib CHUNK_SIZE is 16 MB", ESM.CHUNK_SIZE === 16 * 1024 * 1024);

  // KDF + dual-key separator
  assert("lib deriveKey → 32-byte key", (await ESM.deriveKey("p", Buffer.alloc(32), iters)).length === 32);
  assert("lib combineDualKeys separator", ESM.combineDualKeys("a", "b") === "a\x00ZEFER_DUAL\x00b");

  // answer hashing — deterministic + normalized
  const h1 = await ESM.hashAnswer("Answer");
  const h2 = await ESM.hashAnswer("  answer ");
  assert("lib hashAnswer deterministic + normalized", h1 === h2 && typeof h1 === "string");

  // benchmark
  assert("lib benchmarkDevice returns a number", typeof (await ESM.benchmarkDevice()) === "number");

  // compression helpers
  const z = await ESM.compressBytes(data, "gzip");
  assert("lib compressBytes/decompressBytes", (await ESM.decompressBytes(z, "gzip")).equals(data));
  const sc = await ESM.smartCompress(Buffer.alloc(5000, 65), "gzip");
  assert("lib smartCompress flags compression", sc.wasCompressed === true);

  // attempts counter (round-trip on a throwaway key)
  const k = "zefer_test_key_" + process.pid;
  ESM.setAttempts(k, 3);
  const got = ESM.getAttempts(k);
  ESM.removeAttempts(k);
  assert("lib attempts set/get/remove", got === 3 && ESM.getAttempts(k) === 0);

  // parseFile — public header without decrypting
  const hbuf = await ESM.encodeZefer({ content: "x", passphrase: PASS, fileName: null, expiresAt: 0, hint: "the-hint", iterations: iters });
  const parsed = ESM.parseFile(hbuf.toString("utf-8"), hbuf);
  assert("lib parseFile reads public header", parsed && parsed.binary && parsed.header.hint === "the-hint");
}

console.log("\n  MCP channel (stdio JSON-RPC server)\n");

// Produce library-encrypted files first so the MCP session can decrypt them (cross-channel).
writeFileSync(libZefText, await ESM.encodeZefer({
  content: CONTENT, passphrase: PASS, fileName: null, expiresAt: 0, compression: "deflate", iterations: 50_000,
}));
writeFileSync(libZefFile, await ESM.encodeZefer({
  fileData: Buffer.from(CONTENT, "utf-8"), fileName: "from-lib.txt", fileType: "text/plain",
  passphrase: PASS, expiresAt: 0, iterations: 50_000,
}));

// 15. Drive the real MCP server through all 5 tools (+ cross-channel decrypts)
{
  const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } };
  const { msgs, err } = await mcpCall([
    init,
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "zefer_keygen", arguments: { mode: "base58", length: 24, count: 2 } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "zefer_analyze_password", arguments: { password: "Tr0ub4dor&3" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "zefer_encrypt", arguments: { text: MCP_TEXT, passphrase: PASS, outputPath: mcpZef, compression: "gzip", iterations: 50_000 } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "zefer_decrypt", arguments: { inputPath: mcpZef, passphrase: PASS } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "zefer_inspect", arguments: { inputPath: mcpZef } } },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "zefer_decrypt", arguments: { inputPath: libZefText, passphrase: PASS } } },
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "zefer_decrypt", arguments: { inputPath: libZefFile, passphrase: PASS, outputPath: mcpFileOut, overwrite: true } } },
  ]);

  const by = (id) => msgs.find((m) => m.id === id);
  const toolJson = (id) => JSON.parse(by(id).result.content[0].text);

  assert("MCP initialize → serverInfo", by(1)?.result?.serverInfo?.name === "zefer-cli", err);
  const tools = by(2)?.result?.tools?.map((t) => t.name) ?? [];
  assert("MCP tools/list returns 5 tools",
    tools.length === 5 && ["zefer_encrypt", "zefer_decrypt", "zefer_keygen", "zefer_analyze_password", "zefer_inspect"].every((t) => tools.includes(t)),
    tools.join(","));
  assert("MCP zefer_keygen returns 2 keys", toolJson(3).keys?.length === 2);
  assert("MCP zefer_analyze_password returns score", typeof toolJson(4).score === "number");
  assert("MCP zefer_encrypt writes file", existsSync(mcpZef) && toolJson(5).format === "ZEFB3");
  assert("MCP zefer_decrypt returns content", toolJson(6).content === MCP_TEXT);
  assert("MCP zefer_inspect reads format", String(toolJson(7).format).includes("ZEFB3"));
  assert("MCP decrypts a library-encrypted text file", toolJson(8).content === CONTENT);
  assert("MCP decrypts a library-encrypted FILE",
    existsSync(mcpFileOut) && readFileSync(mcpFileOut, "utf-8") === CONTENT);
}

console.log("\n  Cross-channel matrix\n");

// 16. CLI ⇄ library ⇄ MCP — every producer decrypts in every other channel
{
  // CLI-encrypted (zef2, file mode) → library
  const cliBytes = readFileSync(zef2);
  const a = await ESM.decodeZefer(cliBytes.toString("utf-8"), PASS, { rawBytes: cliBytes });
  assert("library decrypts a CLI-encrypted file", a.ok && a.payload.fileData?.toString("utf-8") === CONTENT);

  // MCP-encrypted (mcpZef, text) → library
  const mcpBytes = readFileSync(mcpZef);
  const b = await ESM.decodeZefer(mcpBytes.toString("utf-8"), PASS, { rawBytes: mcpBytes });
  assert("library decrypts an MCP-encrypted file", b.ok && b.payload.content === MCP_TEXT);

  // library-encrypted (libZefText) → CLI
  const c = run(`decrypt "${libZefText}" -p "${PASS}"`);
  assert("CLI decrypts a library-encrypted file", c.ok && c.out.includes(CONTENT), c.err);

  // MCP-encrypted (mcpZef, text) → CLI
  const d = run(`decrypt "${mcpZef}" -p "${PASS}"`);
  assert("CLI decrypts an MCP-encrypted file", d.ok && d.out.includes(MCP_TEXT), d.err);

  // CLI info reads a library-encrypted file's public header
  const e = run(`info "${libZefFile}"`);
  assert("CLI info reads a library-encrypted file", e.ok && e.out.includes("ZEFB3"), e.err);
}

// ─── Cleanup ───

for (const f of [txtIn, txtOut, zef, zef2, zefGzip, decGzip, zefHint, libZefText, libZefFile, mcpZef, mcpFileOut]) {
  if (existsSync(f)) unlinkSync(f);
}

// ─── Summary ───

console.log(`\n  ${passed} passed  ${failed} failed\n`);
if (failed > 0) process.exit(1);
