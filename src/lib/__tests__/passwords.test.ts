/**
 * Key generation and password analysis — parity with the web `/generator`.
 *
 * Mirrors `app/lib/__tests__/passwords.test.ts`; the algorithms are identical,
 * only the host (Node vs browser) differs.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  CHARSETS,
  MODES,
  generateValue,
  entropyOf,
  charsetFor,
  generateWithOptions,
  analyzePassword,
  bucketCrackTime,
  toSuperscript,
  crackBucketFor,
  complianceOf,
  keyspaceExponent,
  ATTACK_SCENARIOS,
  AVERAGE_HUMAN_BITS,
  DEFAULT_GENERATE_OPTIONS,
  type KeygenMode,
} from "../passwords.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Force `crypto.getRandomValues` to hand out a fixed sequence of uint32s. */
function stubRandomUint32(values: number[]): void {
  let i = 0;
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((array: Uint32Array) => {
    for (let j = 0; j < array.length; j++) array[j] = values[i++ % values.length];
    return array;
  }) as typeof globalThis.crypto.getRandomValues);
}

describe("MODES & CHARSETS", () => {
  it("exposes the 7 canonical modes in web-app order", () => {
    expect(MODES.map((m) => m.key)).toEqual([
      "unicode",
      "secure",
      "alpha",
      "hex",
      "base58",
      "pin",
      "uuid",
    ]);
  });

  it("uses the standard Bitcoin base58 alphabet (no 0, O, I or l)", () => {
    expect(CHARSETS.base58).toHaveLength(58);
    for (const banned of ["0", "O", "I", "l"]) {
      expect(CHARSETS.base58).not.toContain(banned);
    }
  });

  it("uses exactly the ten digits for pin and lowercase hex for hex", () => {
    expect(CHARSETS.pin).toBe("0123456789");
    expect(CHARSETS.hex).toBe("0123456789abcdef");
  });

  it("ships all-off generation defaults", () => {
    expect(DEFAULT_GENERATE_OPTIONS).toEqual({
      excludeAmbiguous: false,
      excludeChars: "",
      requireAllClasses: false,
      noRepeats: false,
      groupSize: 0,
    });
  });
});

describe("generateValue", () => {
  it.each(["secure", "alpha", "hex", "base58", "pin"] as KeygenMode[])(
    "draws %s keys of the requested length from the mode alphabet",
    (mode) => {
      const value = generateValue(mode, 40);
      expect(value).toHaveLength(40);
      const allowed = new Set([...CHARSETS[mode as Exclude<KeygenMode, "uuid">]]);
      expect([...value].every((c) => allowed.has(c))).toBe(true);
    }
  );

  it("counts unicode keys in code points, not UTF-16 units", () => {
    expect([...generateValue("unicode", 24)]).toHaveLength(24);
  });

  it("produces a UUID v7 with the right version and variant nibbles", () => {
    const uuid = generateValue("uuid", 0);
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("puts the current millisecond timestamp in the leading 48 bits", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-05-04T10:20:30.400Z"));
    const uuid = generateValue("uuid", 0);
    vi.useRealTimers();
    const stamp = Number.parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16);
    expect(stamp).toBe(Date.UTC(2031, 4, 4, 10, 20, 30, 400));
  });

  it("produces different values on consecutive calls", () => {
    expect(generateValue("secure", 32)).not.toBe(generateValue("secure", 32));
  });

  it("discards random words at or above the rejection limit (no modulo bias)", () => {
    // pool = 10 → limit = 4294967290. The first word is out of range and must
    // be dropped entirely rather than folded back in with a modulo.
    stubRandomUint32([4294967295, 0, 1, 2, 3]);
    const value = generateValue("pin", 4);
    expect(value).toBe("0123");
  });
});

describe("entropyOf", () => {
  it("returns the fixed 122 bits of a UUID v7", () => {
    expect(entropyOf("uuid", 999)).toBe(122);
  });

  it.each([
    ["hex", 16, 64],
    ["pin", 6, 19],
  ] as [KeygenMode, number, number][])(
    "is floor(log2(pool) * length) for %s",
    (mode, length, expected) => {
      expect(entropyOf(mode, length)).toBe(expected);
    }
  );
});

describe("charsetFor", () => {
  it("returns an empty pool for uuid, which has no alphabet", () => {
    expect(charsetFor("uuid")).toEqual([]);
  });

  it("returns the full alphabet when no options are given", () => {
    expect(charsetFor("hex")).toEqual([..."0123456789abcdef"]);
    expect(charsetFor("hex", {})).toEqual([..."0123456789abcdef"]);
  });

  it("drops the ambiguous characters 0 O 1 l I", () => {
    const chars = charsetFor("alpha", { excludeAmbiguous: true });
    for (const banned of ["0", "O", "1", "l", "I"]) {
      expect(chars).not.toContain(banned);
    }
    expect(chars).toContain("o");
  });

  it("drops explicitly excluded characters", () => {
    expect(charsetFor("hex", { excludeChars: "abcdef" })).toEqual([..."0123456789"]);
  });
});

describe("generateWithOptions", () => {
  it("delegates uuid mode to plain generation", () => {
    expect(generateWithOptions("uuid", 12)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses the full alphabet when called with no options", () => {
    expect(generateWithOptions("hex", 20)).toHaveLength(20);
  });

  it("falls back to plain generation when exclusions leave fewer than 2 characters", () => {
    const value = generateWithOptions("hex", 12, { excludeChars: "0123456789abcde" });
    expect(value).toHaveLength(12);
    expect(value).not.toBe("f".repeat(12)); // the 1-char pool was not used
  });

  it("never emits the same character twice in a row with noRepeats", () => {
    const value = generateWithOptions("pin", 120, { noRepeats: true });
    expect(value).toHaveLength(120);
    expect(/(.)\1/.test(value)).toBe(false);
  });

  it("guarantees every producible class with requireAllClasses", () => {
    for (let i = 0; i < 5; i++) {
      const value = generateWithOptions("secure", 16, { requireAllClasses: true });
      expect(/[a-z]/.test(value)).toBe(true);
      expect(/[A-Z]/.test(value)).toBe(true);
      expect(/\d/.test(value)).toBe(true);
      expect(/[!-/:-@[-`{-~]/.test(value)).toBe(true);
    }
  });

  it("skips the class guarantee when the alphabet yields a single class", () => {
    const value = generateWithOptions("pin", 8, { requireAllClasses: true });
    expect(value).toMatch(/^\d{8}$/);
  });

  it("skips the class guarantee when the key is shorter than the class count", () => {
    const value = generateWithOptions("alpha", 2, { requireAllClasses: true });
    expect(value).toHaveLength(2);
  });

  it("gives up after 64 resamples instead of looping forever", () => {
    // Every draw yields the same character, so the class requirement can never
    // be met: the loop must bail out and still return a value.
    stubRandomUint32([0]);
    const value = generateWithOptions("alpha", 8, { requireAllClasses: true });
    expect(value).toBe("A".repeat(8));
  });

  it("discards random words at or above the rejection limit", () => {
    // Same unbiased rejection sampling as `generateValue`, on the advanced path.
    stubRandomUint32([4294967295, 5, 6, 7, 8]);
    expect(generateWithOptions("pin", 4)).toBe("5678");
  });

  it("groups the output with dashes every N characters", () => {
    const value = generateWithOptions("hex", 12, { groupSize: 4 });
    expect(value).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
  });

  it("leaves a short tail group in place", () => {
    const value = generateWithOptions("hex", 10, { groupSize: 4 });
    expect(value.split("-").map((g) => g.length)).toEqual([4, 4, 2]);
  });

  it("does not group when groupSize is 0", () => {
    expect(generateWithOptions("hex", 12, { groupSize: 0 })).not.toContain("-");
  });
});

describe("analyzePassword — character classes and pool size", () => {
  it("handles the empty string without dividing by zero", () => {
    const a = analyzePassword("");
    expect(a).toMatchObject({
      length: 0,
      poolSize: 0,
      entropyBits: 0,
      effectiveBits: 0,
      classCount: 0,
      score: 0,
    });
    expect(a.crackSeconds).toEqual({ online: 0, offline: 0 });
  });

  it("adds 26 + 26 + 10 + 33 for a full ASCII mix", () => {
    const a = analyzePassword("Abc123!@#xyzQWE");
    expect(a.classes).toEqual({
      lower: true,
      upper: true,
      digits: true,
      symbols: true,
      extended: false,
    });
    expect(a.poolSize).toBe(95);
    expect(a.classCount).toBe(4);
  });

  it("widens the pool by 256 for non-ASCII characters", () => {
    const a = analyzePassword("añoçüé🔐xyzab");
    expect(a.classes.extended).toBe(true);
    expect(a.poolSize).toBe(26 + 256);
  });

  it("uses only the digit pool for a numeric PIN", () => {
    expect(analyzePassword("4729").poolSize).toBe(10);
  });
});

describe("analyzePassword — warnings", () => {
  it("flags a leaked common password and floors its entropy at 12 bits", () => {
    const a = analyzePassword("password");
    expect(a.warnings).toContain("common");
    expect(a.effectiveBits).toBeLessThanOrEqual(12);
    expect(a.score).toBe(0);
  });

  it("strips trailing padding before matching the leak list", () => {
    expect(analyzePassword("password123!").warnings).toContain("common");
  });

  it("flags a password shorter than 8 characters", () => {
    expect(analyzePassword("Ab1!").warnings).toContain("tooShort");
    expect(analyzePassword("A8b!kQz2r").warnings).not.toContain("tooShort");
  });

  it("flags digits-only and single-case-letters-only passwords", () => {
    expect(analyzePassword("83920174").warnings).toContain("onlyDigits");
    const letters = analyzePassword("mjtvrwqkxd");
    expect(letters.warnings).toContain("onlyLetters");
    expect(letters.warnings).not.toContain("onlyDigits");
  });

  it("does not flag onlyLetters when the letters span two cases", () => {
    expect(analyzePassword("mjtvRWQKxd").warnings).not.toContain("onlyLetters");
  });

  it("flags repeated characters and repeated blocks", () => {
    expect(analyzePassword("aaabcd").warnings).toContain("repeats");
    expect(analyzePassword("xyzxyz").warnings).toContain("repeats");
    expect(analyzePassword("xyz").warnings).not.toContain("repeats");
  });

  it("flags ascending and descending sequences of four or more", () => {
    expect(analyzePassword("mk4abcdez").warnings).toContain("sequence");
    expect(analyzePassword("mk4dcbaez").warnings).toContain("sequence");
    expect(analyzePassword("abc").warnings).not.toContain("sequence");
    expect(analyzePassword("mk4abcez").warnings).not.toContain("sequence");
  });

  it("flags keyboard runs in both directions", () => {
    expect(analyzePassword("Zqwerty9!").warnings).toContain("keyboard");
    expect(analyzePassword("Zytrewq9!").warnings).toContain("keyboard");
    expect(analyzePassword("Zmvkspn9!").warnings).not.toContain("keyboard");
  });

  it("flags a leading or trailing year", () => {
    expect(analyzePassword("1998hjkzmq").warnings).toContain("datelike");
    expect(analyzePassword("hjkzmq2024").warnings).toContain("datelike");
    expect(analyzePassword("hj1998zmq").warnings).not.toContain("datelike");
  });

  it("flags low variety for a long single-class ASCII password", () => {
    expect(analyzePassword("mjtvrwqkxdzb").warnings).toContain("lowVariety");
    expect(analyzePassword("añoçüémjtvrwq").warnings).not.toContain("lowVariety");
  });

  it("reports no warnings for a strong generated key", () => {
    const a = analyzePassword("Kq7#mZr2$vXp9!Lw");
    expect(a.warnings).toEqual([]);
    expect(a.score).toBe(4);
    expect(a.effectiveBits).toBe(a.entropyBits);
  });
});

describe("analyzePassword — penalties and scores", () => {
  it("discounts 40% for repeats", () => {
    const a = analyzePassword("Kq7#mZr2$vXppp9!Lw");
    expect(a.warnings).toContain("repeats");
    expect(a.effectiveBits).toBe(Math.round(a.entropyBits * 0.6));
  });

  it("discounts 30% for a sequence or a keyboard run", () => {
    const a = analyzePassword("Kq7#mZr2$vXabcde!Lw");
    expect(a.warnings).toContain("sequence");
    expect(a.effectiveBits).toBe(Math.round(a.entropyBits * 0.7));
  });

  it("subtracts 10 bits for a year", () => {
    const a = analyzePassword("Kq7#mZr2$vXpLw2024");
    expect(a.warnings).toEqual(["datelike"]);
    expect(a.effectiveBits).toBe(a.entropyBits - 10);
  });

  it("never drives the effective entropy below zero", () => {
    expect(analyzePassword("2024").effectiveBits).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ["kqvm", 0],
    ["mjtvrwq", 1],
    ["mjtvrwqkx", 2],
    ["Zmvkspn9!q", 3],
    ["Kq7#mZr2$vXp9!Lw", 4],
  ] as [string, number][])("scores %j as %i", (password, score) => {
    expect(analyzePassword(password).score).toBe(score);
  });

  it("derives crack seconds from the effective entropy and attacker speed", () => {
    const a = analyzePassword("Kq7#mZr2$vXp9!Lw");
    expect(a.crackSeconds.online).toBeCloseTo(Math.pow(2, a.effectiveBits - 1) / 1e4, 0);
    expect(a.crackSeconds.offline).toBeCloseTo(Math.pow(2, a.effectiveBits - 1) / 1e12, 0);
  });
});

describe("bucketCrackTime", () => {
  it.each([
    [0.5, "instant", 0],
    [45, "seconds", 45],
    [600, "minutes", 10],
    [7_200, "hours", 2],
    [86_400 * 3, "days", 3],
    [86_400 * 90, "months", 3],
    [86_400 * 365 * 5, "years", 5],
    [86_400 * 365 * 1e7, "yearsExp", 7],
  ])("buckets %i seconds as %s", (seconds, bucket, value) => {
    expect(bucketCrackTime(seconds)).toEqual({ bucket, value });
  });
});

describe("crackBucketFor", () => {
  it("matches direct arithmetic while the numbers stay small", () => {
    expect(crackBucketFor(30, 1e4)).toEqual(bucketCrackTime(Math.pow(2, 29) / 1e4));
  });

  it("returns a plain year count between a year and a million years", () => {
    const res = crackBucketFor(80, 1e12);
    expect(res.bucket).toBe("years");
    expect(res.value).toBeGreaterThan(0);
    expect(res.value).toBeLessThan(1e6);
  });

  it("never overflows to Infinity for multi-thousand-bit keys", () => {
    const res = crackBucketFor(4096, 1e15);
    expect(res.bucket).toBe("yearsExp");
    expect(Number.isFinite(res.value)).toBe(true);
    expect(res.value).toBeGreaterThan(1000);
  });
});

describe("toSuperscript", () => {
  it("converts digits to Unicode superscripts", () => {
    expect(toSuperscript(1234567890)).toBe("¹²³⁴⁵⁶⁷⁸⁹⁰");
    expect(toSuperscript(0)).toBe("⁰");
  });

  it("truncates to an integer", () => {
    expect(toSuperscript(12.9)).toBe("¹²");
  });

  it("passes non-digit characters such as a minus sign through", () => {
    expect(toSuperscript(-5)).toBe("-⁵");
  });

  it("guards non-finite input", () => {
    expect(toSuperscript(Number.POSITIVE_INFINITY)).toBe("⁹⁹⁹⁺");
    expect(toSuperscript(Number.NaN)).toBe("⁹⁹⁹⁺");
  });
});

describe("compliance, keyspace and scenarios", () => {
  it("evaluates every framework threshold independently", () => {
    expect(complianceOf(0, 4)).toEqual([
      { key: "nist", pass: false },
      { key: "owasp", pass: false },
      { key: "longterm", pass: false },
      { key: "aes128", pass: false },
      { key: "quantum", pass: false },
    ]);
    expect(complianceOf(256, 64).every((c) => c.pass)).toBe(true);
  });

  it.each([
    [8, 63, ["nist"]],
    [8, 64, ["nist", "owasp"]],
    [8, 100, ["nist", "owasp", "longterm"]],
    [8, 128, ["nist", "owasp", "longterm", "aes128"]],
  ] as [number, number, string[]][])(
    "passes exactly %o at length %i / %i bits",
    (length, bits, expected) => {
      expect(
        complianceOf(bits, length)
          .filter((c) => c.pass)
          .map((c) => c.key)
      ).toEqual(expected);
    }
  );

  it("converts bits to a decimal keyspace exponent", () => {
    expect(keyspaceExponent(128)).toBe(38);
    expect(keyspaceExponent(0)).toBe(0);
  });

  it("orders the attack scenarios by increasing speed", () => {
    const speeds = ATTACK_SCENARIOS.map((s) => s.gps);
    expect(speeds).toEqual([...speeds].sort((a, b) => a - b));
    expect(ATTACK_SCENARIOS.map((s) => s.key)).toEqual(["online", "cloud", "gpu", "nation"]);
  });

  it("pins the average human password baseline at 40 bits", () => {
    expect(AVERAGE_HUMAN_BITS).toBe(40);
  });
});
