/**
 * Secure key generation — Node.js port.
 *
 * Five modes, identical character sets to the web version:
 *   alpha   — printable ASCII + symbols (rejection-sampled, no modulo bias)
 *   hex     — lowercase hex (0-9, a-f)
 *   uuid    — UUID v4 format (random, not time-based)
 *   secure  — base64url characters (URL-safe, dense entropy)
 *   unicode — mixed Latin/Cyrillic/Arabic/Hiragana/CJK/emoji
 *
 * All modes use crypto.randomBytes for OS-level CSPRNG entropy.
 */

import * as nodeCrypto from "crypto";

export type KeygenMode = "alpha" | "hex" | "uuid" | "secure" | "unicode";

const ALPHA_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?";

const SECURE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Unicode codepoint ranges (same as the web app)
const UNICODE_RANGES: [number, number][] = [
  [0x0041, 0x007a], // Basic Latin
  [0x00c0, 0x024f], // Extended Latin
  [0x0400, 0x04ff], // Cyrillic
  [0x0600, 0x06ff], // Arabic
  [0x3040, 0x30ff], // Hiragana / Katakana
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0x1f300, 0x1f9ff], // Miscellaneous Symbols and Pictographs
];

/**
 * Rejection-sampling over a character set to eliminate modulo bias.
 */
function sampleFromChars(chars: string, length: number): string {
  const limit = Math.floor(256 / chars.length) * chars.length;
  let result = "";
  while (result.length < length) {
    const needed = (length - result.length) * 2; // over-sample
    const bytes = nodeCrypto.randomBytes(Math.max(needed, 64));
    for (const b of bytes) {
      if (b < limit) {
        result += chars[b % chars.length];
        if (result.length === length) break;
      }
    }
  }
  return result;
}

/**
 * Generate a random Unicode codepoint from the configured ranges.
 * Returns the string (may be a surrogate pair for codepoints > 0xFFFF).
 */
function randomUnicodeChar(): string {
  const totalRange = UNICODE_RANGES.reduce((sum, [lo, hi]) => sum + (hi - lo + 1), 0);
  const limit = Math.floor(0x1_0000_0000 / totalRange) * totalRange;

  // Rejection loop — very tight, exits almost immediately
  while (true) {
    const buf = nodeCrypto.randomBytes(4);
    const val = buf.readUInt32BE(0);
    if (val >= limit) continue;
    const cp = val % totalRange;

    let offset = 0;
    for (const [lo, hi] of UNICODE_RANGES) {
      const rangeSize = hi - lo + 1;
      if (cp < offset + rangeSize) {
        return String.fromCodePoint(lo + (cp - offset));
      }
      offset += rangeSize;
    }
  }
}

/**
 * Generate a random UUID v4 (standard xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx).
 */
function generateUuidV4(): string {
  const bytes = nodeCrypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateKey(mode: KeygenMode, length: number): string {
  switch (mode) {
    case "alpha":
      return sampleFromChars(ALPHA_CHARS, length);

    case "secure":
      return sampleFromChars(SECURE_CHARS, length);

    case "hex":
      return nodeCrypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);

    case "uuid": {
      const uuids: string[] = [];
      let total = 0;
      while (total < length) {
        const u = generateUuidV4();
        uuids.push(u);
        total += u.length + (total > 0 ? 1 : 0); // account for separator
      }
      return uuids.join("-").slice(0, length);
    }

    case "unicode": {
      let result = "";
      while (result.length < length) {
        result += randomUnicodeChar();
      }
      return result.slice(0, length);
    }
  }
}
