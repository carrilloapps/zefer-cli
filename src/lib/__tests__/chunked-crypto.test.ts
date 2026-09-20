/**
 * Chunked AES-256-GCM — 16 MB framing, per-chunk IV derivation and progress.
 */

import { describe, it, expect, vi } from "vitest";
import * as nodeCrypto from "node:crypto";
import { chunkedEncrypt, chunkedDecryptToBuffer, CHUNK_SIZE } from "../chunked-crypto.js";
import { deriveKey } from "../crypto.js";

const ITER = 1_000;

/** Flatten the length-prefixed chunk list into the on-disk chunk region. */
function wire(chunks: Buffer[]): Buffer {
  return Buffer.concat(chunks);
}

describe("CHUNK_SIZE", () => {
  it("is exactly 16 MB — the value shared with the web app", () => {
    expect(CHUNK_SIZE).toBe(16 * 1024 * 1024);
  });
});

describe("chunkedEncrypt framing", () => {
  it("produces a 32-byte salt, a 12-byte base IV and one chunk for small data", async () => {
    const res = await chunkedEncrypt(Buffer.from("small"), "pw", ITER);
    expect(res.salt).toHaveLength(32);
    expect(res.baseIv).toHaveLength(12);
    expect(res.totalChunks).toBe(1);
    expect(res.chunks).toHaveLength(1);
  });

  it("prefixes every chunk with its big-endian ciphertext length", async () => {
    const res = await chunkedEncrypt(Buffer.from("0123456789"), "pw", ITER);
    const chunk = res.chunks[0];
    expect(chunk.readUInt32BE(0)).toBe(chunk.length - 4);
    expect(chunk.length - 4).toBe(10 + 16); // plaintext + GCM tag
  });

  it("still produces one chunk for empty input", async () => {
    const res = await chunkedEncrypt(Buffer.alloc(0), "pw", ITER);
    expect(res.totalChunks).toBe(1);
    expect(res.chunks[0].readUInt32BE(0)).toBe(16); // tag only
  });

  it("accepts a Uint8Array as input", async () => {
    const res = await chunkedEncrypt(new Uint8Array([1, 2, 3]), "pw", ITER);
    const out = await chunkedDecryptToBuffer(wire(res.chunks), res.salt, res.baseIv, "pw", ITER);
    expect(out).toEqual(Buffer.from([1, 2, 3]));
  });
});

describe("round-trip", () => {
  it("restores single-chunk binary data byte for byte", async () => {
    const data = Buffer.from([0, 255, 7, 0, 13, 10, 128]);
    const res = await chunkedEncrypt(data, "pw", ITER);
    const out = await chunkedDecryptToBuffer(wire(res.chunks), res.salt, res.baseIv, "pw", ITER);
    expect(out).toEqual(data);
  });

  it("restores multi-chunk data across the 16 MB boundary", async () => {
    const data = Buffer.alloc(CHUNK_SIZE + 1024, 0xab);
    data.write("HEAD", 0);
    data.write("TAIL", data.length - 4);

    const res = await chunkedEncrypt(data, "pw", ITER);
    expect(res.totalChunks).toBe(2);
    // Identical plaintext blocks must not produce identical ciphertext: the
    // per-chunk IV is what prevents nonce reuse.
    expect(res.chunks[0].subarray(100, 132).equals(res.chunks[1].subarray(100, 132))).toBe(false);

    const out = await chunkedDecryptToBuffer(wire(res.chunks), res.salt, res.baseIv, "pw", ITER);
    expect(out.equals(data)).toBe(true);
  }, 180_000);

  it("accepts Uint8Array salt and base IV on the decrypt side", async () => {
    const res = await chunkedEncrypt(Buffer.from("views"), "pw", ITER);
    const out = await chunkedDecryptToBuffer(
      new Uint8Array(wire(res.chunks)),
      new Uint8Array(res.salt),
      new Uint8Array(res.baseIv),
      "pw",
      ITER
    );
    expect(out.toString()).toBe("views");
  });

  it("rejects a wrong passphrase", async () => {
    const res = await chunkedEncrypt(Buffer.from("secret"), "right", ITER);
    await expect(
      chunkedDecryptToBuffer(wire(res.chunks), res.salt, res.baseIv, "wrong", ITER)
    ).rejects.toThrow();
  });
});

describe("per-chunk IV derivation", () => {
  /**
   * Builds the chunk region by hand so the IV formula is asserted directly:
   * `iv[8..12] = (baseIvCounter XOR chunkIndex) >>> 0`. A base IV whose counter
   * is 0xFFFFFFFF makes the XOR negative as a signed 32-bit int, so a missing
   * `>>> 0` would make the writer throw instead of wrapping.
   */
  it("XORs the base IV counter with the chunk index, unsigned", async () => {
    const salt = Buffer.alloc(32, 9);
    const baseIv = Buffer.alloc(12, 4);
    baseIv.writeUInt32BE(0xffffffff, 8);
    const key = await deriveKey("pw", salt, ITER);

    const plaintexts = [Buffer.from("first-chunk"), Buffer.from("second-chunk")];
    const chunks = plaintexts.map((plain, index) => {
      const iv = Buffer.from(baseIv);
      iv.writeUInt32BE((0xffffffff ^ index) >>> 0, 8);
      const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
      const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length, 0);
      return Buffer.concat([len, body]);
    });

    const out = await chunkedDecryptToBuffer(Buffer.concat(chunks), salt, baseIv, "pw", ITER);
    expect(out.toString()).toBe("first-chunksecond-chunk");
  });
});

describe("progress callbacks", () => {
  it("reports 1/1 for a single-chunk encrypt and decrypt", async () => {
    const onEncrypt = vi.fn();
    const res = await chunkedEncrypt(Buffer.from("x"), "pw", ITER, onEncrypt);
    expect(onEncrypt.mock.calls).toEqual([[1, 1]]);

    const onDecrypt = vi.fn();
    await chunkedDecryptToBuffer(wire(res.chunks), res.salt, res.baseIv, "pw", ITER, onDecrypt);
    expect(onDecrypt.mock.calls).toEqual([[1, 1]]);
  });

  it("reports every chunk in order for multi-chunk data", async () => {
    const data = Buffer.alloc(CHUNK_SIZE + 5, 3);
    const onEncrypt = vi.fn();
    const res = await chunkedEncrypt(data, "pw", ITER, onEncrypt);
    expect(onEncrypt.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);

    const onDecrypt = vi.fn();
    await chunkedDecryptToBuffer(wire(res.chunks), res.salt, res.baseIv, "pw", ITER, onDecrypt);
    expect(onDecrypt.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  }, 180_000);
});

describe("truncated input", () => {
  it("returns an empty buffer when the chunk region is empty", async () => {
    const res = await chunkedEncrypt(Buffer.from("x"), "pw", ITER);
    const out = await chunkedDecryptToBuffer(Buffer.alloc(0), res.salt, res.baseIv, "pw", ITER);
    expect(out).toHaveLength(0);
  });

  it("ignores a trailing stub shorter than the 4-byte length prefix", async () => {
    const res = await chunkedEncrypt(Buffer.from("payload"), "pw", ITER);
    const truncated = Buffer.concat([wire(res.chunks), Buffer.from([0, 0, 0])]);
    const out = await chunkedDecryptToBuffer(truncated, res.salt, res.baseIv, "pw", ITER);
    expect(out.toString()).toBe("payload");
  });
});
