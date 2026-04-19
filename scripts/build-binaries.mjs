#!/usr/bin/env node
/**
 * Build standalone binaries for all platforms using Bun's --compile feature.
 *
 * Process:
 *   1. tsup builds dist/index.mjs (ESM, all deps inlined, react-devtools-core stubbed)
 *   2. bun build --compile packages dist/index.mjs into a self-contained native binary
 *      for each target, embedding its own Bun runtime.
 *
 * No Node.js, no npm, no dependencies required on the target machine.
 *
 * Output:
 *   binaries/zefer-linux-x64           Linux  x64
 *   binaries/zefer-linux-arm64         Linux  ARM64
 *   binaries/zefer-macos-x64           macOS  Intel
 *   binaries/zefer-macos-arm64         macOS  Apple Silicon
 *   binaries/zefer-win-x64.exe         Windows x64
 *   binaries/checksums.txt             SHA-256 of each binary
 */

import { execSync } from "child_process";
import { mkdirSync, createReadStream, writeFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

const ENTRY   = "dist/index.mjs";
const OUT_DIR = "binaries";

// bun build --compile target identifiers
const TARGETS = [
  { bun: "bun-linux-x64",   out: "zefer-linux-x64"   },
  { bun: "bun-linux-arm64", out: "zefer-linux-arm64" },
  { bun: "bun-darwin-x64",  out: "zefer-macos-x64"   },
  { bun: "bun-darwin-arm64",out: "zefer-macos-arm64" },
  { bun: "bun-windows-x64", out: "zefer-win-x64.exe" },
];

// ─── Preflight ───

if (!existsSync(ENTRY)) {
  console.error(`\n  ✗ Missing ${ENTRY} — run "npm run build:cjs" first.\n`);
  process.exit(1);
}

const bunBin = process.env.BUN_BIN ?? "bun";
try {
  execSync(`${bunBin} --version`, { stdio: "pipe" });
} catch {
  console.error(`\n  ✗ bun not found. Install from https://bun.sh\n`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

console.log(`\n  Building zefer-cli binaries → ./${OUT_DIR}/\n`);

// ─── Build each target ───

let built = 0;

for (const { bun, out } of TARGETS) {
  const outPath = join(OUT_DIR, out);
  process.stdout.write(`  ${bun.padEnd(22)} → ${out.padEnd(22)}`);
  try {
    execSync(
      `${bunBin} build --compile ${ENTRY} --outfile ${outPath} --target ${bun}`,
      { stdio: "pipe" }
    );
    const size = (await import("fs")).statSync(outPath).size;
    const mb = (size / 1024 / 1024).toFixed(0);
    console.log(`  ✓  (${mb} MB)`);
    built++;
  } catch (err) {
    console.log(`  ✗`);
    const msg = err.stderr?.toString().trim() ?? err.message;
    console.error(`     ${msg.split("\n")[0]}`);
  }
}

// ─── Checksums ───

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

const lines = [];
for (const { out } of TARGETS) {
  const filePath = join(OUT_DIR, out);
  if (existsSync(filePath)) {
    const checksum = await sha256(filePath);
    lines.push(`${checksum}  ${out}`);
  }
}

if (lines.length > 0) {
  const checksumsPath = join(OUT_DIR, "checksums.txt");
  writeFileSync(checksumsPath, lines.join("\n") + "\n");
  console.log(`\n  checksums.txt written\n`);
}

console.log(`  Built ${built}/${TARGETS.length} binaries.\n`);
if (built < TARGETS.length) process.exit(1);
