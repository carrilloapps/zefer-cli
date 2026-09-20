/**
 * ZEFB3 / ZEFR3 container encode + decode, the legacy read paths and every
 * security guard that lives inside the encrypted payload.
 *
 * The attempt counter writes to `~/.zefer/attempts.json`, so `node:os` is
 * mocked onto a scratch home directory for the whole file.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ZeferHeader, ZeferMeta } from "../zefer.js";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zefer-home-"));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof os>("node:os");
  return { ...actual, homedir: () => HOME };
});

const { encodeZefer, parseFile, decodeZefer } = await import("../zefer.js");
const { encryptBytesToBase64, hashAnswer } = await import("../crypto.js");
const { compressBytes } = await import("../compression.js");

type Header = ZeferHeader;
type Meta = ZeferMeta;

const ITER = 1_000;
const PASS = "passphrase";

beforeEach(() => {
  fs.rmSync(path.join(HOME, ".zefer"), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

// ─── Builders for hand-crafted containers ───

function uint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function baseMeta(overrides: Partial<Meta> = {}): Meta {
  return {
    v: 3,
    fileName: null,
    fileType: null,
    fileSize: 0,
    expiresAt: 0,
    createdAt: Date.now(),
    answerHash: null,
    allowedIps: [],
    question: null,
    maxAttempts: 0,
    ...overrides,
  };
}

function baseHeader(overrides: Partial<Header> = {}): Header {
  return { iterations: ITER, compression: "none", hint: null, note: null, mode: "text", ...overrides };
}

/** [4-byte meta length][meta JSON][content bytes] — the current payload layout. */
function packPrefixed(meta: unknown, data: Buffer): Buffer {
  const metaBytes = Buffer.from(JSON.stringify(meta), "utf-8");
  return Buffer.concat([uint32(metaBytes.length), metaBytes, data]);
}

/** A legacy ZEFER3/ZEFER2 text container: magic, header JSON, base64 lines. */
async function textFile(
  header: Header,
  payloads: Buffer[],
  passphrase = PASS,
  magic = "ZEFER3"
): Promise<string> {
  const lines = await Promise.all(
    payloads.map((p) => encryptBytesToBase64(p, passphrase, header.iterations))
  );
  return [magic, JSON.stringify(header), ...lines].join("\n");
}

/** A ZEFB3 container whose header/body are supplied verbatim. */
function binaryFile(magic: string, header: unknown, body: Buffer): Buffer {
  const headerBytes = Buffer.from(JSON.stringify(header), "utf-8");
  return Buffer.concat([Buffer.from(magic, "ascii"), uint32(headerBytes.length), headerBytes, body]);
}

// ─── encodeZefer ───

describe("encodeZefer — container shape", () => {
  it("writes the ZEFB3 magic and a JSON header for a single-key file", async () => {
    const buf = await encodeZefer({
      content: "hello",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    expect([...buf.subarray(0, 5)]).toEqual([0x5a, 0x45, 0x46, 0x42, 0x33]);

    const headerLen = buf.readUInt32BE(5);
    const header = JSON.parse(buf.subarray(9, 9 + headerLen).toString("utf-8"));
    expect(header).toEqual({
      iterations: ITER,
      compression: "none",
      hint: null,
      note: null,
      mode: "text",
    });
  });

  it("writes the ZEFR3 magic and two blocks when a reveal key is given", async () => {
    const buf = await encodeZefer({
      content: "hello",
      passphrase: PASS,
      revealKey: "reveal-key",
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    expect([...buf.subarray(0, 5)]).toEqual([0x5a, 0x45, 0x46, 0x52, 0x33]);

    const headerLen = buf.readUInt32BE(5);
    const mainBlockSize = buf.readUInt32BE(9 + headerLen);
    const rest = buf.length - (9 + headerLen + 4);
    expect(mainBlockSize).toBeGreaterThan(44);
    expect(rest).toBeGreaterThan(mainBlockSize); // a second, independent block follows
  });

  it("never leaks the reveal key or any security metadata into the public header", async () => {
    const buf = await encodeZefer({
      content: "hello",
      passphrase: PASS,
      revealKey: "reveal-key",
      question: "Pet?",
      questionAnswer: "firulais",
      allowedIps: ["10.0.0.1"],
      maxAttempts: 3,
      expiresAt: Date.now() + 60_000,
      fileName: "secret.txt",
      iterations: ITER,
    });
    const headerLen = buf.readUInt32BE(5);
    const headerJson = buf.subarray(9, 9 + headerLen).toString("utf-8");
    expect(Object.keys(JSON.parse(headerJson)).sort()).toEqual([
      "compression",
      "hint",
      "iterations",
      "mode",
      "note",
    ]);
    for (const secret of ["reveal-key", "Pet?", "firulais", "10.0.0.1", "secret.txt"]) {
      expect(headerJson).not.toContain(secret);
    }
  });

  it("defaults to 600k iterations and no compression", async () => {
    const buf = await encodeZefer({ content: "x", passphrase: PASS, fileName: null, expiresAt: 0 });
    const headerLen = buf.readUInt32BE(5);
    expect(JSON.parse(buf.subarray(9, 9 + headerLen).toString("utf-8"))).toMatchObject({
      iterations: 600_000,
      compression: "none",
    });
  }, 120_000);

  it("marks file mode whenever fileData is present, even alongside content", async () => {
    const buf = await encodeZefer({
      content: "ignored",
      fileData: Buffer.from("bytes"),
      passphrase: PASS,
      fileName: "a.bin",
      expiresAt: 0,
      iterations: ITER,
    });
    const headerLen = buf.readUInt32BE(5);
    expect(JSON.parse(buf.subarray(9, 9 + headerLen).toString("utf-8")).mode).toBe("file");
  });

  it("strips HTML-ish characters from the public hint and note", async () => {
    const buf = await encodeZefer({
      content: "x",
      passphrase: PASS,
      hint: '  <b>two "parts"</b> & more  ',
      note: "  ",
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    const headerLen = buf.readUInt32BE(5);
    const header = JSON.parse(buf.subarray(9, 9 + headerLen).toString("utf-8"));
    expect(header.hint).toBe("btwo parts/b  more");
    expect(header.note).toBeNull(); // whitespace-only collapses to null
  });

  it("reports progress through every lifecycle stage", async () => {
    const calls: string[] = [];
    const onProgress = {
      compressing: (p: number) => calls.push(`compressing:${p}`),
      compressingDone: () => calls.push("compressingDone"),
      deriving: () => calls.push("deriving"),
      derivingDone: () => calls.push("derivingDone"),
      encrypting: (ci: number, tc: number) => calls.push(`encrypting:${ci}/${tc}`),
      packaging: () => calls.push("packaging"),
    };

    await encodeZefer({
      content: "hello",
      passphrase: PASS,
      revealKey: "reveal",
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
      onProgress,
    });

    expect(calls).toEqual([
      "compressing:0",
      "compressingDone",
      "deriving",
      "derivingDone",
      "encrypting:1/2",
      "encrypting:2/2",
      "packaging",
    ]);
  });
});

// ─── parseFile ───

describe("parseFile", () => {
  it("splits a ZEFR3 file into a main block of the declared size plus a reveal block", async () => {
    const buf = await encodeZefer({
      content: "hello",
      passphrase: PASS,
      revealKey: "reveal",
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    const headerLen = buf.readUInt32BE(5);
    const mainBlockSize = buf.readUInt32BE(9 + headerLen);

    const parsed = parseFile("", buf)!;
    expect(parsed.binary).toBe(true);
    expect(parsed.binaryData!).toHaveLength(mainBlockSize);
    expect(parsed.revealBinaryData!).toHaveLength(
      buf.length - (9 + headerLen + 4) - mainBlockSize
    );
  });

  it("leaves revealBinaryData undefined for a ZEFB3 file", async () => {
    const buf = await encodeZefer({
      content: "hello",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    const parsed = parseFile("", buf)!;
    expect(parsed.binaryData).toBeDefined();
    expect(parsed.revealBinaryData).toBeUndefined();
  });

  it("defaults a missing header mode to 'file' for binary containers", () => {
    const buf = binaryFile("ZEFB3", { iterations: ITER, compression: "none" }, Buffer.alloc(50));
    expect(parseFile("", buf)!.header.mode).toBe("file");
  });

  it.each([
    ["random bytes", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])],
    ["an empty buffer", Buffer.alloc(0)],
    ["a buffer shorter than the magic", Buffer.from([0x5a, 0x45, 0x46])],
    ["a ZEF?3 magic with an unknown kind byte", Buffer.from("ZEFX3____________", "ascii")],
    ["a magic that only matches the tail byte", Buffer.from("XXXX3____________", "ascii")],
  ])("returns null for %s", (_label, bytes) => {
    expect(parseFile(bytes.toString("utf-8"), bytes)).toBeNull();
  });

  it("returns null when the binary header is not valid JSON", () => {
    const headerBytes = Buffer.from("{ not json", "utf-8");
    const buf = Buffer.concat([
      Buffer.from("ZEFB3", "ascii"),
      uint32(headerBytes.length),
      headerBytes,
      Buffer.alloc(50),
    ]);
    expect(parseFile("", buf)).toBeNull();
  });

  it("parses a legacy ZEFER3 text container with several encrypted lines", async () => {
    const content = await textFile(baseHeader({ hint: "look inside" }), [
      Buffer.from("a"),
      Buffer.from("b"),
    ]);
    const parsed = parseFile(content)!;
    expect(parsed.binary).toBe(false);
    expect(parsed.encryptedLines).toHaveLength(2);
    expect(parsed.header.hint).toBe("look inside");
  });

  it("accepts the ZEFER2 magic too", async () => {
    const content = await textFile(baseHeader(), [Buffer.from("a")], PASS, "ZEFER2");
    expect(parseFile(content)).not.toBeNull();
  });

  it("defaults a missing header mode to 'text' for legacy containers", () => {
    const content = ["ZEFER3", JSON.stringify({ iterations: ITER, compression: "none" }), "x"].join(
      "\n"
    );
    expect(parseFile(content)!.header.mode).toBe("text");
  });

  it.each([
    ["fewer than three lines", "ZEFER3\n{}"],
    ["an unknown magic line", "ZEFER9\n{}\npayload"],
    ["a header line that is not JSON", "ZEFER3\nnot-json\npayload"],
  ])("returns null for a text container with %s", (_label, content) => {
    expect(parseFile(content)).toBeNull();
  });
});

// ─── decodeZefer — happy paths ───

describe("decodeZefer — round-trips", () => {
  it("restores text content and its metadata", async () => {
    const expiresAt = Date.now() + 3_600_000;
    const buf = await encodeZefer({
      content: "the secret",
      passphrase: PASS,
      fileName: null,
      expiresAt,
      maxAttempts: 0,
      allowedIps: ["10.0.0.1", "::1"],
      iterations: ITER,
    });

    const res = await decodeZefer("", PASS, { rawBytes: buf });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.content).toBe("the secret");
    expect(res.payload.fileData).toBeNull();
    expect(res.payload.meta).toMatchObject({
      v: 3,
      fileName: null,
      fileType: null,
      expiresAt,
      allowedIps: ["10.0.0.1", "::1"],
      question: null,
      maxAttempts: 0,
    });
    expect(res.header.mode).toBe("text");
  });

  it("restores file bytes with their name, type and size", async () => {
    const fileData = Buffer.from([0, 1, 2, 250, 255]);
    const buf = await encodeZefer({
      fileData,
      passphrase: PASS,
      fileName: "photo.png",
      fileType: "image/png",
      expiresAt: 0,
      iterations: ITER,
    });

    const res = await decodeZefer("", PASS, { rawBytes: buf });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.fileData).toEqual(fileData);
    expect(res.payload.content).toBeNull();
    expect(res.payload.meta).toMatchObject({
      fileName: "photo.png",
      fileType: "image/png",
      fileSize: fileData.length,
    });
  });

  it("treats a missing content field as the empty string", async () => {
    const buf = await encodeZefer({ passphrase: PASS, fileName: null, expiresAt: 0, iterations: ITER });
    const res = await decodeZefer("", PASS, { rawBytes: buf });
    expect(res.ok && res.payload.content).toBe("");
  });

  it.each(["gzip", "deflate", "deflate-raw"] as const)("round-trips %s-compressed content", async (compression) => {
    const content = "zefer ".repeat(500);
    const buf = await encodeZefer({
      content,
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      compression,
      iterations: ITER,
    });
    const res = await decodeZefer("", PASS, { rawBytes: buf });
    expect(res.ok && res.payload.content).toBe(content);
  });

  it("enforces the library decompression cap when asked to", async () => {
    const content = "zefer ".repeat(5000);
    const buf = await encodeZefer({
      content,
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      compression: "gzip",
      iterations: ITER,
    });
    await expect(decodeZefer("", PASS, { rawBytes: buf, maxDecompressSize: 64 })).rejects.toThrow(
      /exceeds maximum allowed size/
    );
    const uncapped = await decodeZefer("", PASS, { rawBytes: buf, maxDecompressSize: 0 });
    expect(uncapped.ok && uncapped.payload.content).toBe(content);
  });

  it("round-trips a dual-key file only with both halves", async () => {
    const buf = await encodeZefer({
      content: "two-person",
      passphrase: "first",
      secondPassphrase: "second",
      dualKey: true,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });

    const both = await decodeZefer("", "first", { rawBytes: buf, secondPassphrase: "second" });
    expect(both.ok && both.payload.content).toBe("two-person");

    const single = await decodeZefer("", "first", { rawBytes: buf });
    expect(single).toEqual({ ok: false, error: "wrong_passphrase" });
  });

  it("ignores a second passphrase when dualKey was not requested", async () => {
    const buf = await encodeZefer({
      content: "single",
      passphrase: "first",
      secondPassphrase: "second",
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    const res = await decodeZefer("", "first", { rawBytes: buf, secondPassphrase: "second" });
    expect(res.ok && res.payload.content).toBe("single");
  });

  it("opens a ZEFR3 file with either the main passphrase or the reveal key", async () => {
    const buf = await encodeZefer({
      content: "shared",
      passphrase: PASS,
      revealKey: "reveal-key",
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });

    const viaMain = await decodeZefer("", PASS, { rawBytes: buf });
    const viaReveal = await decodeZefer("", "reveal-key", { rawBytes: buf });
    expect(viaMain.ok && viaMain.payload.content).toBe("shared");
    expect(viaReveal.ok && viaReveal.payload.content).toBe("shared");
    expect(viaMain.ok && viaReveal.ok && viaMain.payload.meta).toEqual(
      viaReveal.ok ? viaReveal.payload.meta : null
    );
  });

  it("reports decrypt progress for both the deriving and chunk stages", async () => {
    const buf = await encodeZefer({
      content: "progress",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      compression: "gzip",
      iterations: ITER,
    });

    const calls: string[] = [];
    await decodeZefer("", PASS, {
      rawBytes: buf,
      onProgress: {
        deriving: () => calls.push("deriving"),
        derivingDone: () => calls.push("derivingDone"),
        decrypting: (ci, tc) => calls.push(`decrypting:${ci}/${tc}`),
        decompressing: () => calls.push("decompressing"),
        verifying: () => calls.push("verifying"),
      },
    });

    expect(calls).toEqual([
      "deriving",
      "derivingDone",
      "decrypting:1/1",
      "decompressing",
      "verifying",
    ]);
  });

  it("reports one progress step per 16 MB chunk in both directions", async () => {
    const { CHUNK_SIZE } = await import("../chunked-crypto.js");
    const content = "z".repeat(CHUNK_SIZE + 1_024); // two chunks

    const encodeCalls: string[] = [];
    const buf = await encodeZefer({
      content,
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
      onProgress: {
        compressing: () => {},
        compressingDone: () => {},
        deriving: () => encodeCalls.push("deriving"),
        derivingDone: () => encodeCalls.push("derivingDone"),
        encrypting: (ci, tc) => encodeCalls.push(`encrypting:${ci}/${tc}`),
        packaging: () => encodeCalls.push("packaging"),
      },
    });

    expect(encodeCalls).toEqual([
      "deriving",
      "derivingDone",
      "encrypting:1/2",
      "encrypting:2/2",
      "packaging",
    ]);

    const decodeCalls: string[] = [];
    const res = await decodeZefer("", PASS, {
      rawBytes: buf,
      onProgress: {
        deriving: () => decodeCalls.push("deriving"),
        derivingDone: () => decodeCalls.push("derivingDone"),
        decrypting: (ci, tc) => decodeCalls.push(`decrypting:${ci}/${tc}`),
        decompressing: () => decodeCalls.push("decompressing"),
        verifying: () => decodeCalls.push("verifying"),
      },
    });

    expect(res.ok && res.payload.content).toBe(content);
    expect(decodeCalls).toEqual([
      "deriving",
      "derivingDone",
      "decrypting:1/2",
      "decrypting:2/2",
      "decompressing",
      "verifying",
    ]);
  }, 180_000);
});

// ─── decodeZefer — failures and guards ───

describe("decodeZefer — rejections", () => {
  it("returns invalid_format for content that is not a zefer file", async () => {
    expect(await decodeZefer("just some text", PASS)).toEqual({
      ok: false,
      error: "invalid_format",
    });
    expect(await decodeZefer("", PASS, { rawBytes: Buffer.alloc(0) })).toEqual({
      ok: false,
      error: "invalid_format",
    });
  });

  it("returns wrong_passphrase for the wrong key", async () => {
    const buf = await encodeZefer({
      content: "x",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    expect(await decodeZefer("", "nope", { rawBytes: buf })).toEqual({
      ok: false,
      error: "wrong_passphrase",
    });
  });

  it("pads a fast rejection out to the 100 ms floor (timing-attack mitigation)", async () => {
    const buf = await encodeZefer({
      content: "x",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    const start = performance.now();
    await decodeZefer("", "nope", { rawBytes: buf });
    expect(performance.now() - start).toBeGreaterThanOrEqual(95);
  });

  it("does not pad a rejection that already took longer than the floor", async () => {
    const buf = await encodeZefer({
      content: "x",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      iterations: 600_000, // derivation alone exceeds MIN_RESPONSE_MS
    });
    const start = performance.now();
    const res = await decodeZefer("", "nope", { rawBytes: buf });
    const elapsed = performance.now() - start;
    expect(res).toEqual({ ok: false, error: "wrong_passphrase" });
    expect(elapsed).toBeGreaterThan(100);
  }, 120_000);

  it("returns wrong_passphrase when the main block is shorter than salt+IV", async () => {
    const buf = binaryFile("ZEFB3", baseHeader(), Buffer.alloc(20));
    expect(await decodeZefer("", PASS, { rawBytes: buf })).toEqual({
      ok: false,
      error: "wrong_passphrase",
    });
  });

  it("returns expired once the payload timestamp is in the past", async () => {
    const buf = await encodeZefer({
      content: "x",
      passphrase: PASS,
      fileName: null,
      expiresAt: Date.now() - 1_000,
      iterations: ITER,
    });
    expect(await decodeZefer("", PASS, { rawBytes: buf })).toEqual({ ok: false, error: "expired" });
  });
});

describe("decodeZefer — secret question", () => {
  async function build(maxAttempts = 0) {
    return encodeZefer({
      content: "guarded",
      passphrase: PASS,
      question: "Pet name?",
      questionAnswer: "Firulais",
      maxAttempts,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
  }

  it("asks for an answer when none is supplied", async () => {
    expect(await decodeZefer("", PASS, { rawBytes: await build() })).toEqual({
      ok: false,
      error: "needs_answer",
    });
  });

  it("accepts the answer case-insensitively and with stray whitespace", async () => {
    const buf = await build();
    const res = await decodeZefer("", PASS, { rawBytes: buf, questionAnswer: "  fIRULAIS " });
    expect(res.ok && res.payload.content).toBe("guarded");
  });

  it("rejects a wrong answer without counting attempts when maxAttempts is 0", async () => {
    const buf = await build(0);
    expect(await decodeZefer("", PASS, { rawBytes: buf, questionAnswer: "rex" })).toEqual({
      ok: false,
      error: "wrong_answer",
    });
    expect(fs.existsSync(path.join(HOME, ".zefer", "attempts.json"))).toBe(false);
  });

  it("skips the answer check when the payload has a hash but no question", async () => {
    const payload = packPrefixed(
      baseMeta({ answerHash: await hashAnswer("x"), question: null }),
      Buffer.from("no question asked")
    );
    const content = await textFile(baseHeader(), [payload]);
    const res = await decodeZefer(content, PASS);
    expect(res.ok && res.payload.content).toBe("no question asked");
  });
});

describe("decodeZefer — attempt counter", () => {
  const STORE = path.join(HOME, ".zefer", "attempts.json");

  async function guardedFile(maxAttempts: number) {
    return textFile(
      baseHeader(),
      [
        packPrefixed(
          baseMeta({
            maxAttempts,
            question: "Pet name?",
            answerHash: await hashAnswer("firulais"),
          }),
          Buffer.from("guarded")
        ),
      ]
    );
  }

  it("counts a wrong answer and blocks once the budget is spent", async () => {
    const content = await guardedFile(2);

    expect(await decodeZefer(content, PASS, { questionAnswer: "rex" })).toEqual({
      ok: false,
      error: "wrong_answer",
    });
    expect(await decodeZefer(content, PASS, { questionAnswer: "rex" })).toEqual({
      ok: false,
      error: "wrong_answer",
    });
    expect(await decodeZefer(content, PASS, { questionAnswer: "rex" })).toEqual({
      ok: false,
      error: "max_attempts",
    });
    // The right answer no longer helps: the file is locked.
    expect(await decodeZefer(content, PASS, { questionAnswer: "firulais" })).toEqual({
      ok: false,
      error: "max_attempts",
    });
  });

  it("clears the counter after a successful decryption", async () => {
    const content = await guardedFile(3);
    await decodeZefer(content, PASS, { questionAnswer: "rex" });
    expect(JSON.parse(fs.readFileSync(STORE, "utf-8"))).not.toEqual({});

    const ok = await decodeZefer(content, PASS, { questionAnswer: "firulais" });
    expect(ok.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(STORE, "utf-8"))).toEqual({});
  });

  it("tracks binary files under the shared 'bin' key", async () => {
    const buf = await encodeZefer({
      content: "x",
      passphrase: PASS,
      question: "Q?",
      questionAnswer: "a",
      maxAttempts: 1,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    await decodeZefer("", PASS, { rawBytes: buf, questionAnswer: "wrong" });
    expect(Object.keys(JSON.parse(fs.readFileSync(STORE, "utf-8")))).toEqual(["bin"]);
  });
});

// ─── Legacy payload layouts ───

describe("legacy payload layouts", () => {
  it("reads a null-byte separated payload (older ZEFER3)", async () => {
    const meta = baseMeta();
    const payload = Buffer.concat([
      Buffer.from(JSON.stringify(meta), "utf-8"),
      Buffer.from([0]),
      Buffer.from("null separated"),
    ]);
    const res = await decodeZefer(await textFile(baseHeader(), [payload]), PASS);
    expect(res.ok && res.payload.content).toBe("null separated");
  });

  it("reads a whole-JSON ZEFER2 payload and fills in the missing fields", async () => {
    const payload = Buffer.from(
      JSON.stringify({
        content: "legacy body",
        fileName: "old.txt",
        expiresAt: 0,
        createdAt: 1_600_000_000_000,
        answerHash: null,
      }),
      "utf-8"
    );
    const res = await decodeZefer(await textFile(baseHeader(), [payload], PASS, "ZEFER2"), PASS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.content).toBe("legacy body");
    expect(res.payload.meta).toMatchObject({
      fileName: "old.txt",
      allowedIps: [],
      question: null,
      maxAttempts: 0,
      fileSize: 0,
    });
  });

  it("fills a ZEFER2 payload without a content field with the empty string", async () => {
    const payload = Buffer.from(JSON.stringify({ expiresAt: 0, createdAt: 0 }), "utf-8");
    const res = await decodeZefer(await textFile(baseHeader(), [payload], PASS, "ZEFER2"), PASS);
    expect(res.ok && res.payload.content).toBe("");
  });

  it("tries every encrypted line until one decrypts", async () => {
    const good = packPrefixed(baseMeta(), Buffer.from("second line wins"));
    const content = [
      "ZEFER3",
      JSON.stringify(baseHeader()),
      "not-even-base64",
      await encryptBytesToBase64(good, PASS, ITER),
    ].join("\n");
    const res = await decodeZefer(content, PASS);
    expect(res.ok && res.payload.content).toBe("second line wins");
  });

  it("decrypts a compressed legacy text payload", async () => {
    const body = await compressBytes(Buffer.from("zefer ".repeat(100)), "gzip");
    const payload = packPrefixed(baseMeta(), body);
    const content = await textFile(baseHeader({ compression: "gzip" }), [payload]);
    const res = await decodeZefer(content, PASS);
    expect(res.ok && res.payload.content).toBe("zefer ".repeat(100));
  });

  it("returns file mode payloads as bytes for legacy containers too", async () => {
    const payload = packPrefixed(baseMeta({ fileName: "x.bin" }), Buffer.from([7, 8, 9]));
    const content = await textFile(baseHeader({ mode: "file" }), [payload]);
    const res = await decodeZefer(content, PASS);
    expect(res.ok && res.payload.fileData).toEqual(Buffer.from([7, 8, 9]));
  });
});

describe("payload validation", () => {
  /** Encrypt an arbitrary plaintext into a legacy text container. */
  async function withPayload(payload: Buffer): Promise<string> {
    return textFile(baseHeader(), [payload]);
  }

  it.each([
    ["a payload shorter than the 4-byte meta prefix", Buffer.from([1, 2])],
    ["a zero-length meta prefix", Buffer.concat([uint32(0), Buffer.from("body")])],
    ["a meta length beyond the payload", Buffer.concat([uint32(9999), Buffer.from("body")])],
    [
      "meta bytes that are not JSON",
      Buffer.concat([uint32(4), Buffer.from("oops"), Buffer.from("body")]),
    ],
  ])("rejects %s", async (_label, payload) => {
    expect(await decodeZefer(await withPayload(payload), PASS)).toEqual({
      ok: false,
      error: "wrong_passphrase",
    });
  });

  it.each([
    ["a non-object meta", 42],
    ["JSON null", null],
    ["a wrong schema version", { ...baseMeta(), v: 2 }],
    ["a non-numeric expiresAt", { ...baseMeta(), expiresAt: "soon" }],
    ["a non-numeric createdAt", { ...baseMeta(), createdAt: null }],
    ["a non-numeric maxAttempts", { ...baseMeta(), maxAttempts: "3" }],
    ["a non-numeric fileSize", { ...baseMeta(), fileSize: "12" }],
    ["a non-array allowedIps", { ...baseMeta(), allowedIps: "10.0.0.1" }],
  ])("rejects %s in the length-prefixed layout", async (_label, meta) => {
    // The JSON still parses, so this exercises the metadata schema check
    // rather than the JSON guard — the null-separated and ZEFER2 fallbacks
    // then fail too, leaving wrong_passphrase.
    const payload = packPrefixed(meta, Buffer.from("body"));
    expect(await decodeZefer(await withPayload(payload), PASS)).toEqual({
      ok: false,
      error: "wrong_passphrase",
    });
  });

  it("rejects a legacy text container when no line decrypts at all", async () => {
    const content = await textFile(baseHeader(), [packPrefixed(baseMeta(), Buffer.from("x"))]);
    expect(await decodeZefer(content, "wrong-passphrase")).toEqual({
      ok: false,
      error: "wrong_passphrase",
    });
  });

  it("rejects a null-separated payload whose meta half is not JSON", async () => {
    const payload = Buffer.concat([
      Buffer.from("not-json", "utf-8"),
      Buffer.from([0]),
      Buffer.from("body"),
    ]);
    expect(await decodeZefer(await withPayload(payload), PASS)).toEqual({
      ok: false,
      error: "wrong_passphrase",
    });
  });

  it("rejects an invalid meta placed before a null separator", async () => {
    const payload = Buffer.concat([
      Buffer.from(JSON.stringify({ v: 1 }), "utf-8"),
      Buffer.from([0]),
      Buffer.from("body"),
    ]);
    expect(await decodeZefer(await withPayload(payload), PASS)).toEqual({
      ok: false,
      error: "wrong_passphrase",
    });
  });

  it("rejects a null byte at the very start or very end of the payload", async () => {
    for (const payload of [
      Buffer.concat([Buffer.from([0]), Buffer.from("body")]),
      Buffer.concat([Buffer.from("body"), Buffer.from([0])]),
    ]) {
      expect(await decodeZefer(await withPayload(payload), PASS)).toEqual({
        ok: false,
        error: "wrong_passphrase",
      });
    }
  });
});
