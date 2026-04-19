#!/usr/bin/env node
/**
 * Remove all build artifacts.
 * Equivalent to: rm -rf dist/ binaries/
 * Cross-platform (works on Windows without needing rimraf).
 */

import { rmSync, existsSync } from "fs";

const DIRS = ["dist", "binaries"];

for (const dir of DIRS) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`  removed ${dir}/`);
  }
}
console.log("  clean done");
