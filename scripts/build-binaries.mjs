#!/usr/bin/env node
/**
 * Build standalone binaries for all platforms (or one specific platform).
 *
 * Usage:
 *   node scripts/build-binaries.mjs                    # all platforms
 *   node scripts/build-binaries.mjs --target linux-x64 # one platform
 *   node scripts/build-binaries.mjs --current          # current machine only
 *
 * Toolchain:
 *   tsup  → dist/index.mjs  (all deps bundled, react-devtools-core stubbed)
 *   bun   → native binary per platform (embeds its own runtime)
 *
 * Output directory: binaries/
 *   zefer-linux-x64
 *   zefer-linux-arm64
 *   zefer-macos-x64
 *   zefer-macos-arm64
 *   zefer-win-x64.exe
 *   checksums.txt
 */

import { execSync } from "child_process";
import { mkdirSync, createReadStream, writeFileSync, existsSync, statSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

const ENTRY   = "dist/index.mjs";
const OUT_DIR = "binaries";

// Platform registry — bun target → output filename
const ALL_TARGETS = [
  { id: "linux-x64",   bun: "bun-linux-x64",    out: "zefer-linux-x64"   },
  { id: "linux-arm64", bun: "bun-linux-arm64",   out: "zefer-linux-arm64" },
  { id: "macos-x64",   bun: "bun-darwin-x64",    out: "zefer-macos-x64"   },
  { id: "macos-arm64", bun: "bun-darwin-arm64",   out: "zefer-macos-arm64" },
  { id: "win-x64",     bun: "bun-windows-x64",   out: "zefer-win-x64.exe" },
];

// ─── Detect current platform ───

function currentPlatformId() {
  const os   = process.platform;   // linux | darwin | win32
  const arch = process.arch;       // x64 | arm64
  if (os === "linux")  return arch === "arm64" ? "linux-arm64"  : "linux-x64";
  if (os === "darwin") return arch === "arm64" ? "macos-arm64"  : "macos-x64";
  if (os === "win32")  return "win-x64";
  return null;
}

// ─── Argument parsing ───

const args = process.argv.slice(2);
const targetArg    = args.find((a) => a.startsWith("--target="))?.split("=")[1]
                  ?? (args.includes("--target") ? args[args.indexOf("--target") + 1] : null);
const buildCurrent = args.includes("--current");

let targets;
if (buildCurrent) {
  const id = currentPlatformId();
  if (!id) { console.error("  ✗ Unknown platform — use --target <id>"); process.exit(1); }
  targets = ALL_TARGETS.filter((t) => t.id === id);
} else if (targetArg) {
  targets = ALL_TARGETS.filter((t) => t.id === targetArg);
  if (targets.length === 0) {
    console.error(`  ✗ Unknown target: ${targetArg}`);
    console.error(`    Valid targets: ${ALL_TARGETS.map((t) => t.id).join(", ")}`);
    process.exit(1);
  }
} else {
  targets = ALL_TARGETS;
}

// ─── Preflight checks ───

if (!existsSync(ENTRY)) {
  console.error(`\n  ✗ ${ENTRY} not found — run "npm run build:cjs" first\n`);
  process.exit(1);
}

const bunBin = process.env.BUN_BIN ?? "bun";
try {
  const bunVersion = execSync(`${bunBin} --version`, { stdio: "pipe" }).toString().trim();
  console.log(`\n  Using Bun ${bunVersion}`);
} catch {
  console.error(`\n  ✗ bun not found — install from https://bun.sh\n`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const label = targetArg ? `[${targetArg}]` : buildCurrent ? "[current]" : "[all platforms]";
console.log(`  Building zefer-cli binaries ${label}\n`);

// ─── Build ───

let built = 0;

for (const { id, bun, out } of targets) {
  const outPath = join(OUT_DIR, out);
  process.stdout.write(`  ${id.padEnd(14)} → ${out.padEnd(24)}`);
  try {
    execSync(
      `${bunBin} build --compile ${ENTRY} --outfile ${outPath} --target ${bun}`,
      { stdio: "pipe" }
    );
    const mb = (statSync(outPath).size / 1024 / 1024).toFixed(0);
    console.log(`✓  (${mb} MB)`);
    built++;
  } catch (err) {
    console.log(`✗`);
    const msg = (err.stderr?.toString() ?? err.message).split("\n")[0].trim();
    console.error(`               ${msg}`);
  }
}

// ─── Checksums ───

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(filePath).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
}

const lines = [];
for (const { out } of targets) {
  const fp = join(OUT_DIR, out);
  if (existsSync(fp)) lines.push(`${await sha256(fp)}  ${out}`);
}
if (lines.length) {
  writeFileSync(join(OUT_DIR, "checksums.txt"), lines.join("\n") + "\n");
  console.log(`\n  checksums.txt written`);
}

console.log(`\n  ${built}/${targets.length} binaries built → ./${OUT_DIR}/\n`);
if (built < targets.length) process.exit(1);
