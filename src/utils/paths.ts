/**
 * Path safety helpers for anything that ends up on disk.
 *
 * Threat model — two very different kinds of path reach the write sites:
 *
 *  1. **Caller-chosen destinations** (`zefer decrypt -o <path>`, the MCP
 *     `inputPath` / `outputPath` arguments). These are explicit instructions
 *     from the principal driving the tool, so an absolute path outside the
 *     working directory is legitimate, not traversal. They are only normalized
 *     and checked for junk (`sanitizeExplicitPath`).
 *
 *  2. **Payload-supplied names** (`ZeferMeta.fileName`, stored *inside* the
 *     encrypted blob). Whoever produced the `.zefer` file controls this string,
 *     so a hostile file can claim to be named `../../../.ssh/authorized_keys`
 *     and steer the write anywhere the process can reach. This is a real
 *     zip-slip: the user asked to decrypt a file, not to overwrite their shell
 *     profile. Such a name is never treated as a path — it is reduced to a bare
 *     file name, rejected outright if that name could still escape, and then
 *     resolved inside the working directory (`sanitizeOutputName`).
 */

import * as path from "node:path";

/**
 * A Windows drive prefix (`C:`). `path.resolve` reads it as *drive-relative*,
 * resolving against that drive's own working directory instead of ours — the
 * one single-segment name that can still escape. Rejected on every platform so
 * a hostile name behaves identically wherever the file is decrypted.
 */
const DRIVE_PREFIX = /^[a-zA-Z]:/;

/**
 * Reduce an untrusted, payload-supplied name to an absolute path that is
 * guaranteed to sit directly inside the current working directory.
 * Throws when the name cannot yield a usable file name.
 */
export function sanitizeOutputName(untrustedName: string): string {
  // Drop NUL bytes and flatten both separator styles, so a Windows-style name
  // like `..\..\evil` is reduced on POSIX too, where `\` is a legal character.
  const flattened = untrustedName.replaceAll("\0", "").replaceAll(/[\\/]+/g, path.sep);
  const base = path.basename(flattened).trim();

  // `base` is a single path segment now: it carries no separator and cannot
  // climb out on its own. Only `.`, `..` and a drive prefix still can.
  if (!base || base === "." || base === ".." || DRIVE_PREFIX.test(base)) {
    throw new Error(`Unsafe file name in .zefer metadata: "${untrustedName}"`);
  }

  return path.resolve(process.cwd(), base);
}

/**
 * Normalize a destination the caller chose explicitly into an absolute path.
 * Rejects empty paths and NUL bytes (which silently truncate paths in libc).
 */
export function sanitizeExplicitPath(rawPath: string): string {
  const cleaned = rawPath.replaceAll("\0", "").trim();
  if (!cleaned) {
    throw new Error(`Invalid path: "${rawPath}"`);
  }
  return path.resolve(cleaned);
}
