/**
 * Programmatic library entry point — the published `zefer-cli` surface.
 *
 * It must stay free of terminal UI and side effects, and it must expose the
 * same core the CLI and the MCP server use.
 */

import { describe, it, expect } from "vitest";
import * as lib from "../lib.js";

describe("library entry point", () => {
  it("exports the documented API", () => {
    for (const name of [
      // binary format
      "encodeZefer",
      "decodeZefer",
      "parseFile",
      // crypto primitives
      "encrypt",
      "decrypt",
      "encryptRaw",
      "decryptFromBase64",
      "decryptFromBinary",
      "deriveKey",
      "combineDualKeys",
      "hashAnswer",
      "benchmarkDevice",
      // chunked crypto
      "chunkedEncrypt",
      "chunkedDecryptToBuffer",
      "CHUNK_SIZE",
      // compression
      "compressBytes",
      "decompressBytes",
      "smartCompress",
      "MAX_DECOMPRESS_SIZE",
      // passwords
      "generateValue",
      "generateWithOptions",
      "analyzePassword",
      "complianceOf",
      "crackBucketFor",
      // attempts
      "getAttempts",
      "setAttempts",
      "removeAttempts",
    ]) {
      expect(lib, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it("pulls in no terminal UI", () => {
    expect(lib).not.toHaveProperty("render");
    expect(lib).not.toHaveProperty("EncryptApp");
    expect(lib).not.toHaveProperty("startMcpServer");
  });

  it("round-trips through the exported API alone", async () => {
    const buf = await lib.encodeZefer({
      content: "library round trip",
      passphrase: "library-pass",
      fileName: null,
      expiresAt: 0,
      compression: "gzip",
      iterations: 1_000,
    });

    const res = await lib.decodeZefer(buf.toString("utf-8"), "library-pass", { rawBytes: buf });
    expect(res.ok && res.payload.content).toBe("library round trip");
  });

  it("scores a key it generated itself", () => {
    const key = lib.generateWithOptions("secure", 32);
    expect(lib.analyzePassword(key).score).toBe(4);
  });
});
