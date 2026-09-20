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

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Resolve an executable to an absolute path up front, so the child process is
 * never started by an implicit PATH lookup. Returns `null` when not found.
 */
function resolveExecutable(name) {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];

  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const pkg     = JSON.parse(readFileSync("package.json", "utf-8"));
const version = pkg.version;
const tag     = `v${version}`;

// Verify git tag exists
const git = resolveExecutable("git");
if (!git) {
  console.error(`\n  ✗ git not found in PATH\n`);
  process.exit(1);
}
try {
  execFileSync(git, ["rev-parse", tag], { stdio: "pipe" });
} catch {
  console.error(`\n  ✗ Git tag ${tag} not found.`);
  console.error(`    Run "npm run release:patch|minor|major" first to bump version and create the tag.\n`);
  process.exit(1);
}

// Verify gh CLI is available
const gh = resolveExecutable("gh");
if (!gh) {
  console.error(`\n  ✗ gh (GitHub CLI) not found — install from https://cli.github.com\n`);
  process.exit(1);
}

console.log(`\n  Creating GitHub release ${tag}...`);

try {
  const out = execFileSync(
    gh,
    ["release", "create", tag, "--generate-notes", "--title", tag],
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
