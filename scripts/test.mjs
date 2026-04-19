#!/usr/bin/env node
/**
 * Smoke test suite for zefer-cli.
 *
 * Tests:
 *   1. --version and --help exit 0
 *   2. All 5 keygen modes produce output
 *   3. Encrypt text → produces .zefer file
 *   4. Decrypt .zefer → original content matches
 *   5. Wrong passphrase → exits 1
 *   6. Encrypt file mode → round-trip with --force
 *   7. Encrypt with gzip compression → round-trip
 *   8. info command reads public header
 */

import { execSync, execFileSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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

// 3. keygen modes
for (const mode of ["secure", "alpha", "hex", "uuid", "unicode"]) {
  const kg = run(`keygen --mode ${mode} --length 32`);
  assert(`keygen --mode ${mode}`, kg.ok && kg.out.trim().length > 0);
}

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

// ─── Cleanup ───

for (const f of [txtIn, txtOut, zef, zef2, zefGzip, decGzip, zefHint]) {
  if (existsSync(f)) unlinkSync(f);
}

// ─── Summary ───

console.log(`\n  ${passed} passed  ${failed} failed\n`);
if (failed > 0) process.exit(1);
