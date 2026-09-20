/**
 * AES-256-GCM + PBKDF2 primitives.
 *
 * Mirrors `app/lib/__tests__/crypto.test.ts` in the web app, adapted from
 * Web Crypto to `node:crypto`.
 */

import { describe, it, expect } from "vitest";
import {
  toBase64,
  fromBase64,
  encodeText,
  decodeBytes,
  deriveKey,
  combineDualKeys,
  encrypt,
  encryptBytesToBase64,
  encryptRaw,
  decrypt,
  decryptFromBase64,
  decryptFromBinary,
  hashAnswer,
  benchmarkDevice,
} from "../crypto.js";

const ITER = 1_000; // keep PBKDF2 cheap — the algorithm, not the cost, is under test

describe("encoding helpers", () => {
  it("round-trips arbitrary bytes through base64", () => {
    const data = Buffer.from([0, 1, 127, 128, 255, 42]);
    expect(fromBase64(toBase64(data))).toEqual(data);
  });

  it("round-trips an empty buffer", () => {
    expect(toBase64(Buffer.alloc(0))).toBe("");
    expect(fromBase64("")).toEqual(Buffer.alloc(0));
  });

  it("accepts a Uint8Array as well as a Buffer", () => {
    const view = new Uint8Array([1, 2, 3]);
    expect(fromBase64(toBase64(view))).toEqual(Buffer.from(view));
    expect(decodeBytes(new Uint8Array([104, 105]))).toBe("hi");
  });

  it("round-trips UTF-8 text including astral characters", () => {
    const text = "héllo 🔐 世界";
    expect(decodeBytes(encodeText(text))).toBe(text);
    expect(encodeText(text).length).toBeGreaterThan(text.length);
  });
});

describe("deriveKey", () => {
  it("returns a 32-byte key and is deterministic for the same inputs", async () => {
    const salt = Buffer.alloc(32, 7);
    const a = await deriveKey("pass", salt, ITER);
    const b = await deriveKey("pass", salt, ITER);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
  });

  it("produces a different key for a different salt", async () => {
    const a = await deriveKey("pass", Buffer.alloc(32, 1), ITER);
    const b = await deriveKey("pass", Buffer.alloc(32, 2), ITER);
    expect(a.equals(b)).toBe(false);
  });
});

describe("encrypt + decrypt (text)", () => {
  it("round-trips a UTF-8 string", async () => {
    const wire = await encrypt("secret message ✅", "passphrase", ITER);
    expect(await decrypt(wire, "passphrase", ITER)).toBe("secret message ✅");
  });

  it("uses the 600k default iteration count on both sides", async () => {
    const wire = await encrypt("default-iterations", "pw");
    expect(await decrypt(wire, "pw")).toBe("default-iterations");
  }, 120_000);

  it("rejects a wrong passphrase", async () => {
    const wire = await encrypt("secret", "right", ITER);
    await expect(decrypt(wire, "wrong", ITER)).rejects.toThrow();
  });

  it("rejects the right passphrase with the wrong iteration count", async () => {
    const wire = await encrypt("secret", "right", ITER);
    await expect(decrypt(wire, "right", ITER + 1)).rejects.toThrow();
  });
});

describe("encryptBytesToBase64 + decryptFromBase64", () => {
  it("produces three dot-separated base64 parts", async () => {
    const wire = await encryptBytesToBase64(Buffer.from([1, 2, 3]), "pw", ITER);
    const parts = wire.split(".");
    expect(parts).toHaveLength(3);
    expect(fromBase64(parts[0])).toHaveLength(32); // salt
    expect(fromBase64(parts[1])).toHaveLength(12); // iv
  });

  it("round-trips binary data", async () => {
    const data = Buffer.from([0, 255, 128, 64, 0, 0, 13, 10]);
    const wire = await encryptBytesToBase64(data, "pw", ITER);
    expect(await decryptFromBase64(wire, "pw", ITER)).toEqual(data);
  });
});

describe("encryptRaw", () => {
  it("returns a 32-byte salt, 12-byte IV and a ciphertext 16 bytes longer than the plaintext", async () => {
    const plaintext = Buffer.from("0123456789");
    const { salt, iv, ciphertext } = await encryptRaw(plaintext, "pw", ITER);
    expect(salt).toHaveLength(32);
    expect(iv).toHaveLength(12);
    expect(ciphertext).toHaveLength(plaintext.length + 16); // + GCM auth tag
  });

  it("uses a fresh salt and IV on every call", async () => {
    const a = await encryptRaw(Buffer.from("x"), "pw", ITER);
    const b = await encryptRaw(Buffer.from("x"), "pw", ITER);
    expect(a.salt.equals(b.salt)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("defaults to 600k iterations when none is given", async () => {
    const { salt, iv, ciphertext } = await encryptRaw(Buffer.from("x"), "pw");
    const wire = Buffer.concat([salt, iv, ciphertext]);
    expect((await decryptFromBinary(wire, "pw")).toString()).toBe("x");
  }, 120_000);
});

describe("decryptFromBinary", () => {
  it("decrypts the salt||iv||ciphertext layout produced by encryptRaw", async () => {
    const { salt, iv, ciphertext } = await encryptRaw(Buffer.from("binary-layout"), "pw", ITER);
    const wire = Buffer.concat([salt, iv, ciphertext]);
    expect((await decryptFromBinary(wire, "pw", ITER)).toString()).toBe("binary-layout");
  });

  it("accepts a Uint8Array and rejects a wrong passphrase", async () => {
    const { salt, iv, ciphertext } = await encryptRaw(Buffer.from("x"), "pw", ITER);
    const wire = new Uint8Array(Buffer.concat([salt, iv, ciphertext]));
    expect((await decryptFromBinary(wire, "pw", ITER)).toString()).toBe("x");
    await expect(decryptFromBinary(wire, "nope", ITER)).rejects.toThrow();
  });
});

describe("combineDualKeys", () => {
  it("joins both halves with the \\x00ZEFER_DUAL\\x00 separator", () => {
    expect(combineDualKeys("a", "b")).toBe("a\x00ZEFER_DUAL\x00b");
    expect(combineDualKeys("", "")).toBe("\x00ZEFER_DUAL\x00");
    expect(combineDualKeys("p@$s", "🔑")).toBe("p@$s\x00ZEFER_DUAL\x00🔑");
  });

  it("derives a key that the primary passphrase alone cannot reproduce", async () => {
    const wire = await encrypt("dual", combineDualKeys("one", "two"), ITER);
    await expect(decrypt(wire, "one", ITER)).rejects.toThrow();
    expect(await decrypt(wire, combineDualKeys("one", "two"), ITER)).toBe("dual");
  });
});

describe("hashAnswer", () => {
  it("is deterministic and normalizes case and surrounding whitespace", async () => {
    const base = await hashAnswer("Firulais");
    expect(await hashAnswer("  firulais  ")).toBe(base);
    expect(await hashAnswer("FIRULAIS")).toBe(base);
  });

  it("returns a distinct non-empty base64 digest per answer", async () => {
    const a = await hashAnswer("blue");
    const b = await hashAnswer("red");
    expect(a).not.toBe(b);
    expect(fromBase64(a)).toHaveLength(32);
  });
});

describe("benchmarkDevice", () => {
  it("estimates a positive, finite ms-per-100k-iterations figure", async () => {
    const ms = await benchmarkDevice();
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThan(0);
  });
});
