/**
 * zlib-backed compression layer — round-trips, the decompression-bomb cap and
 * the `smartCompress` "only if smaller" rule.
 */

import { describe, it, expect, vi } from "vitest";
import * as zlib from "node:zlib";
import {
  compressBytes,
  decompressBytes,
  smartCompress,
  MAX_DECOMPRESS_SIZE,
  type CompressionMethod,
} from "../compression.js";

const METHODS: CompressionMethod[] = ["gzip", "deflate", "deflate-raw"];
const COMPRESSIBLE = Buffer.from("zefer ".repeat(2000));

describe("MAX_DECOMPRESS_SIZE", () => {
  it("defaults to 512 MB", () => {
    expect(MAX_DECOMPRESS_SIZE).toBe(512 * 1024 * 1024);
  });
});

describe("compressBytes + decompressBytes", () => {
  it.each(METHODS)("round-trips through %s and actually shrinks the input", async (method) => {
    const compressed = await compressBytes(COMPRESSIBLE, method);
    expect(compressed.length).toBeLessThan(COMPRESSIBLE.length);
    expect(await decompressBytes(compressed, method)).toEqual(COMPRESSIBLE);
  });

  it("passes data through unchanged for method 'none'", async () => {
    const data = Buffer.from([1, 2, 3]);
    expect(await compressBytes(data, "none")).toEqual(data);
    expect(await decompressBytes(data, "none")).toEqual(data);
  });

  it("accepts a Uint8Array on both sides", async () => {
    const view = new Uint8Array(COMPRESSIBLE);
    const compressed = await compressBytes(view, "gzip");
    expect(await decompressBytes(new Uint8Array(compressed), "gzip")).toEqual(COMPRESSIBLE);
  });

  it("returns the input untouched for an unknown method coming off a header", async () => {
    // `header.compression` is read from an untrusted JSON header, so a value
    // outside the union can reach this function at runtime.
    const data = Buffer.from("unknown-method");
    expect(await decompressBytes(data, "lzma" as CompressionMethod)).toEqual(data);
  });
});

describe("decompression-bomb cap", () => {
  it("throws when the output exceeds the requested cap", async () => {
    const compressed = await compressBytes(COMPRESSIBLE, "gzip");
    await expect(decompressBytes(compressed, "gzip", 128)).rejects.toThrow(
      /exceeds maximum allowed size/
    );
  });

  it("allows output right up to the cap", async () => {
    const compressed = await compressBytes(COMPRESSIBLE, "gzip");
    const out = await decompressBytes(compressed, "gzip", COMPRESSIBLE.length);
    expect(out).toEqual(COMPRESSIBLE);
  });

  it("disables the cap for 0 and for non-finite values", async () => {
    const compressed = await compressBytes(COMPRESSIBLE, "deflate");
    expect(await decompressBytes(compressed, "deflate", 0)).toEqual(COMPRESSIBLE);
    expect(await decompressBytes(compressed, "deflate", Number.NaN)).toEqual(COMPRESSIBLE);
    expect(await decompressBytes(compressed, "deflate", -1)).toEqual(COMPRESSIBLE);
  });
});

describe("smartCompress", () => {
  it("keeps the compressed form when it is smaller", async () => {
    const res = await smartCompress(COMPRESSIBLE, "gzip");
    expect(res.wasCompressed).toBe(true);
    expect(res.data.length).toBeLessThan(COMPRESSIBLE.length);
    expect(await decompressBytes(res.data, "gzip")).toEqual(COMPRESSIBLE);
  });

  it("returns the original for method 'none'", async () => {
    const res = await smartCompress(COMPRESSIBLE, "none");
    expect(res).toEqual({ data: COMPRESSIBLE, wasCompressed: false });
  });

  it("returns the original when compression would make it bigger", async () => {
    const incompressible = Buffer.from([0x1f, 0x8b, 0x42, 0x99]); // 4 random-ish bytes
    const res = await smartCompress(incompressible, "gzip");
    expect(res.wasCompressed).toBe(false);
    expect(res.data).toEqual(incompressible);
  });

  it("falls back to the original when zlib itself fails", async () => {
    vi.resetModules();
    vi.doMock("node:zlib", async () => {
      const actual = await vi.importActual<typeof zlib>("node:zlib");
      return {
        ...actual,
        gzip: (_data: unknown, cb: (err: Error) => void) => cb(new Error("zlib unavailable")),
      };
    });
    try {
      const mod = await import("../compression.js");
      const res = await mod.smartCompress(COMPRESSIBLE, "gzip");
      expect(res).toEqual({ data: COMPRESSIBLE, wasCompressed: false });
    } finally {
      vi.doUnmock("node:zlib");
      vi.resetModules();
    }
  });
});
