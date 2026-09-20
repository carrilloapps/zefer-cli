/**
 * `zefer info` — the passphrase-free inspection report.
 *
 * Fixtures are built once: a real encrypted container (for valid structure and
 * high ciphertext entropy) plus hand-crafted variants for the header-driven and
 * failure branches.
 */

import React from "react";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { render } from "ink-testing-library";
import { InfoApp } from "../info.js";
import { encodeZefer, type ZeferHeader } from "../../lib/zefer.js";
import { encryptBytesToBase64 } from "../../lib/crypto.js";
import { ICON_OK, ICON_ERR, ICON_ARROW } from "../../utils/terminal.js";

const ITER = 1_000;
const PASS = "passphrase";
let dir: string;

function uint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/** Swap the public header of a real container, keeping its encrypted body. */
function rewriteHeader(buf: Buffer, header: Partial<ZeferHeader>): Buffer {
  const headerLen = buf.readUInt32BE(5);
  const current = JSON.parse(buf.subarray(9, 9 + headerLen).toString("utf-8"));
  const bytes = Buffer.from(JSON.stringify({ ...current, ...header }), "utf-8");
  return Buffer.concat([buf.subarray(0, 5), uint32(bytes.length), bytes, buf.subarray(9 + headerLen)]);
}

function write(name: string, data: Buffer | string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
}

function frameOf(input: string): string {
  const { lastFrame, unmount } = render(<InfoApp input={input} />);
  const frame = lastFrame()!;
  unmount();
  return frame;
}

let plain: Buffer;
let withReveal: Buffer;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zefer-info-"));
  const content = "zefer".repeat(30_000); // ≥ 64 KB so the entropy sample is full
  plain = await encodeZefer({
    content,
    passphrase: PASS,
    fileName: null,
    expiresAt: 0,
    iterations: ITER,
  });
  withReveal = await encodeZefer({
    content,
    passphrase: PASS,
    revealKey: "reveal-key",
    fileName: null,
    expiresAt: 0,
    iterations: ITER,
  });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("InfoApp — unreadable or unrecognized input", () => {
  it("reports a file it cannot read", () => {
    const frame = frameOf(path.join(dir, "does-not-exist.zefer"));
    expect(frame).toContain(`${ICON_ERR} Cannot read file:`);
    expect(frame).toContain("ENOENT");
  });

  it("reports a file that is not a zefer container", () => {
    const file = write("plain.txt", "just some text, definitely not zefer");
    const frame = frameOf(file);
    expect(frame).toContain(`${ICON_ERR} Not a valid .zefer file`);
    expect(frame).toContain("plain.txt");
    expect(frame).toContain("36 B");
  });
});

describe("InfoApp — ZEFB3 container", () => {
  it("shows the header, deep analysis and KDF resistance table", () => {
    const file = write("plain.zefer", plain);
    const frame = frameOf(file);

    expect(frame).toContain(`${ICON_ARROW} zefer info`);
    expect(frame).toContain("ZEFB3 (binary, single key)");
    expect(frame).toContain("Mode");
    expect(frame).toContain("text");
    expect(frame).toContain((1_000).toLocaleString());
    expect(frame).toContain("none");

    expect(frame).toContain("Deep analysis");
    expect(frame).toContain(`${ICON_OK} structure valid`);
    expect(frame).toContain("Chunks");
    expect(frame).toContain("Est. content");
    expect(frame).toContain("Randomness");
    expect(frame).toContain("Salt (public)");
    expect(frame).toContain("Base IV (public)");
    expect(frame).toMatch(/SHA-256\s+[0-9a-f]{64}/);

    expect(frame).toContain("Passphrase resistance with this KDF");
    expect(frame).toContain("6 common chars (~28 bits)");
    expect(frame).toContain("64-char generated (~400 bits)");
    expect(frame).toContain("instant"); // a weak passphrase against a weak KDF
    expect(frame).toMatch(/≈10[⁰¹²³⁴⁵⁶⁷⁸⁹]+ years/); // a generated key
  });

  it("reports near-perfect randomness for real AES output", () => {
    const frame = frameOf(write("entropy.zefer", plain));
    const randomness = /Randomness\s+([\d.]+) bits\/byte/.exec(frame)!;
    expect(Number(randomness[1])).toBeGreaterThan(7.9);
  });

  it("warns about a standard-level KDF and says nothing else", () => {
    const frame = frameOf(write("weak-kdf.zefer", plain));
    expect(frame).toContain("KDF at standard level");
    expect(frame).not.toContain("Public hint visible");
  });

  it("reports no observations for a file that follows best practices", () => {
    const strong = rewriteHeader(plain, { iterations: 1_000_000 });
    const frame = frameOf(write("strong.zefer", strong));
    expect(frame).toContain(`${ICON_OK} none — the file follows best practices`);
    expect(frame).toContain((1_000_000).toLocaleString());
  });

  it("surfaces the public hint, note and compression as observations", () => {
    const annotated = rewriteHeader(plain, {
      iterations: 600_000,
      hint: "two parts needed",
      note: "for Alice",
      compression: "gzip",
    });
    const frame = frameOf(write("annotated.zefer", annotated));

    expect(frame).toContain("Hint");
    expect(frame).toContain("two parts needed");
    expect(frame).toContain("Note");
    expect(frame).toContain("for Alice");
    expect(frame).toContain("Features");
    expect(frame).toContain("Public hint visible without the passphrase");
    expect(frame).toContain("Public note visible to anyone holding the file");
    expect(frame).toContain("Compression enabled");
    expect(frame).toContain("(before decompression)");
    expect(frame).not.toContain("KDF at standard level");
  });

  it("colours 300k iterations as the middle tier without warning about the KDF", () => {
    const mid = rewriteHeader(plain, { iterations: 300_000 });
    const frame = frameOf(write("mid.zefer", mid));
    expect(frame).toContain((300_000).toLocaleString());
    expect(frame).toContain("KDF at standard level"); // 300k is still below 600k
  });
});

describe("InfoApp — ZEFR3 container", () => {
  it("names the reveal-key format and counts both blocks' chunks", () => {
    const frame = frameOf(write("reveal.zefer", withReveal));
    expect(frame).toContain("ZEFR3 (binary, with reveal key)");
    expect(frame).toContain("reveal key");
    expect(frame).toContain("Reveal key included");
    expect(frame).toContain(`${ICON_OK} structure valid`);

    const chunks = /Chunks\s+(\d+)/.exec(frame)!;
    expect(Number(chunks[1])).toBe(2); // one per block
  });
});

describe("InfoApp — damaged container", () => {
  it("flags broken chunk framing and low ciphertext randomness", () => {
    const headerBytes = Buffer.from(
      JSON.stringify({ iterations: 600_000, compression: "none", hint: null, note: null, mode: "file" }),
      "utf-8"
    );
    const body = Buffer.concat([
      Buffer.alloc(44), // salt + base IV
      uint32(100), // one plausible chunk…
      Buffer.alloc(100),
      Buffer.alloc(2048), // …then zeroed garbage: a 0-length chunk header
    ]);
    const file = write(
      "broken.zefer",
      Buffer.concat([Buffer.from("ZEFB3", "ascii"), uint32(headerBytes.length), headerBytes, body])
    );

    const frame = frameOf(file);
    expect(frame).toContain(`${ICON_ERR} structure inconsistent — corrupted or truncated`);
    expect(frame).toContain("Internal structure does not match the declared format");
    expect(frame).toContain("Ciphertext randomness is unusually low");
    expect(frame).toMatch(/Randomness\s+0\.\d\d bits\/byte/); // ~0, not ~8
  });

  it("flags a body too short to hold a single chunk", () => {
    const headerBytes = Buffer.from(JSON.stringify({ iterations: 600_000, compression: "none" }), "utf-8");
    const file = write(
      "tiny.zefer",
      Buffer.concat([
        Buffer.from("ZEFB3", "ascii"),
        uint32(headerBytes.length),
        headerBytes,
        Buffer.alloc(50),
      ])
    );
    const frame = frameOf(file);
    expect(frame).toContain(`${ICON_ERR} structure inconsistent`);
    expect(frame).not.toContain("Randomness"); // sample below 1 KB → not measured
  });
});

describe("InfoApp — legacy text containers", () => {
  it("names ZEFER3 and skips the binary-only rows", async () => {
    const line = await encryptBytesToBase64(Buffer.from("legacy"), PASS, ITER);
    const file = write(
      "legacy.zefer",
      ["ZEFER3", JSON.stringify({ iterations: ITER, compression: "none", mode: "text" }), line].join("\n")
    );
    const frame = frameOf(file);

    expect(frame).toContain("ZEFER3 (legacy text)");
    expect(frame).not.toContain("structure valid");
    expect(frame).not.toContain("Chunks");
    expect(frame).not.toContain("Salt (public)");
    expect(frame).toMatch(/SHA-256\s+[0-9a-f]{64}/);
  });

  it("names ZEFER2 too", async () => {
    const line = await encryptBytesToBase64(Buffer.from("legacy"), PASS, ITER);
    const file = write(
      "legacy2.zefer",
      ["ZEFER2", JSON.stringify({ iterations: ITER, compression: "none" }), line].join("\n")
    );
    expect(frameOf(file)).toContain("ZEFER2 (legacy text)");
  });

  it("falls back to 'unknown' when the magic is not at the very start", async () => {
    // `parseFile` trims before splitting, so a leading blank line still parses
    // while the raw bytes no longer begin with a known magic.
    const line = await encryptBytesToBase64(Buffer.from("legacy"), PASS, ITER);
    const file = write(
      "padded.zefer",
      ["", "ZEFER3", JSON.stringify({ iterations: ITER, compression: "none" }), line].join("\n")
    );
    expect(frameOf(file)).toContain("unknown");
  });
});
