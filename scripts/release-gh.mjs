#!/usr/bin/env node
/**
 * Create a GitHub release for the current package version.
 *
 * Usage:
 *   node scripts/release-gh.mjs
 *   npm run release:gh
 *
 * What it does:
 *   1. Reads version from package.json
 *   2. Checks that the git tag v<version> exists locally
 *   3. Creates the GitHub release with auto-generated notes
 *   4. Prints the release URL
 *
 * This triggers:
 *   - .github/workflows/publish.yml  → npm publish
 *   - .github/workflows/binaries.yml → standalone binaries for all platforms
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";

const pkg     = JSON.parse(readFileSync("package.json", "utf-8"));
const version = pkg.version;
const tag     = `v${version}`;

// Verify git tag exists
try {
  execSync(`git rev-parse ${tag}`, { stdio: "pipe" });
} catch {
  console.error(`\n  ✗ Git tag ${tag} not found.`);
  console.error(`    Run "npm run release:patch|minor|major" first to bump version and create the tag.\n`);
  process.exit(1);
}

// Verify gh CLI is available
try {
  execSync("gh --version", { stdio: "pipe" });
} catch {
  console.error(`\n  ✗ gh (GitHub CLI) not found — install from https://cli.github.com\n`);
  process.exit(1);
}

console.log(`\n  Creating GitHub release ${tag}...`);

try {
  const out = execSync(
    `gh release create ${tag} --generate-notes --title "${tag}"`,
    { encoding: "utf-8", stdio: "pipe" }
  );
  console.log(`\n  ✓ Release created: ${out.trim()}`);
  console.log(`\n  GitHub Actions will now:`);
  console.log(`    • publish.yml   → npm publish zefer-cli@${version}`);
  console.log(`    • binaries.yml  → build and upload platform binaries\n`);
} catch (err) {
  const msg = err.stderr?.toString().trim() ?? err.message;
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}
