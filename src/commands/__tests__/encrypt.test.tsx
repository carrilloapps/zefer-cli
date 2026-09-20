/**
 * `zefer encrypt` — the Ink command end to end: input resolution (text, file,
 * stdin), the iteration benchmark, the verbose panel and the failure path.
 */

import React from "react";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { render } from "ink-testing-library";
import { ICON_OK, ICON_ERR } from "../../utils/terminal.js";
import type * as CryptoModule from "../../lib/crypto.js";
import type { EncryptOptions } from "../encrypt.js";

let benchmarkMs = 1;

vi.mock("../../lib/crypto.js", async () => {
  const actual = await vi.importActual<typeof CryptoModule>("../../lib/crypto.js");
  return { ...actual, benchmarkDevice: async () => benchmarkMs };
});

const { EncryptApp } = await import("../encrypt.js");
const { decodeZefer, parseFile } = await import("../../lib/zefer.js");

const ITER = 1_000;
const PASS = "passphrase";
const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zefer-encrypt-"));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  Object.defineProperty(process, "stdin", realStdin);
});

function options(overrides: Partial<EncryptOptions> = {}): EncryptOptions {
  return {
    input: "-",
    output: path.join(dir, "out.zefer"),
    passphrase: PASS,
    ttl: 0,
    iterations: ITER,
    compression: "none",
    maxAttempts: 0,
    allowedIps: [],
    dualKey: false,
    verbose: false,
    ...overrides,
  };
}

/** Render the command and wait until it reports success or failure. */
async function run(opts: EncryptOptions): Promise<string> {
  const instance = render(<EncryptApp {...opts} />);
  await vi.waitFor(
    () => {
      const frame = instance.lastFrame() ?? "";
      if (!frame.includes(ICON_OK) && !frame.includes(ICON_ERR)) {
        throw new Error(`still running:\n${frame}`);
      }
    },
    { timeout: 30_000, interval: 10 }
  );
  const frame = instance.lastFrame()!;
  instance.unmount();
  return frame;
}

function headerOf(file: string) {
  const buf = fs.readFileSync(file);
  return JSON.parse(buf.subarray(9, 9 + buf.readUInt32BE(5)).toString("utf-8"));
}

describe("EncryptApp — text input", () => {
  it("writes a ZEFB3 file that decrypts back to the original text", async () => {
    const output = path.join(dir, "text.zefer");
    const frame = await run(options({ output, textContent: "the secret" }));

    expect(frame).toContain(ICON_OK);
    expect(frame).toContain("text.zefer");
    expect(frame).toMatch(/in \d+ms/);

    const buf = fs.readFileSync(output);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("ZEFB3");
    const res = await decodeZefer("", PASS, { rawBytes: buf });
    expect(res.ok && res.payload.content).toBe("the secret");
  });

  it("shows the input size in the header subtitle", async () => {
    const output = path.join(dir, "subtitle.zefer");
    const instance = render(<EncryptApp {...options({ output, textContent: "0123456789" })} />);
    await vi.waitFor(() => {
      if (!instance.lastFrame()!.includes(ICON_OK)) throw new Error("pending");
    }, { timeout: 30_000, interval: 10 });
    expect(instance.lastFrame()).toContain(`text (10 B) → ${output}`);
    instance.unmount();
  });
});

describe("EncryptApp — file input", () => {
  it("stores the file name and a MIME type derived from the extension", async () => {
    const input = path.join(dir, "report.pdf");
    fs.writeFileSync(input, Buffer.from("%PDF-1.4 fake"));
    const output = `${input}.zefer`;

    const frame = await run(options({ input, output }));
    expect(frame).toContain(ICON_OK);

    const res = await decodeZefer("", PASS, { rawBytes: fs.readFileSync(output) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.meta).toMatchObject({ fileName: "report.pdf", fileType: "application/pdf" });
    expect(res.payload.fileData!.toString()).toBe("%PDF-1.4 fake");
  });

  it("falls back to application/octet-stream for a file without an extension", async () => {
    const input = path.join(dir, "LICENSE");
    fs.writeFileSync(input, "MIT");
    const output = path.join(dir, "license.zefer");

    await run(options({ input, output }));
    const res = await decodeZefer("", PASS, { rawBytes: fs.readFileSync(output) });
    expect(res.ok && res.payload.meta.fileType).toBe("application/octet-stream");
  });

  it("reports an unreadable input file as an error", async () => {
    const frame = await run(options({ input: path.join(dir, "missing.bin") }));
    expect(frame).toContain(ICON_ERR);
    expect(frame).toContain("ENOENT");
  });
});

describe("EncryptApp — stdin input", () => {
  it("encrypts piped bytes with no file name", async () => {
    Object.defineProperty(process, "stdin", {
      value: Readable.from([Buffer.from("piped payload")]),
      configurable: true,
    });
    const output = path.join(dir, "stdin.zefer");
    const frame = await run(options({ input: "-", output }));

    expect(frame).toContain(ICON_OK);
    const res = await decodeZefer("", PASS, { rawBytes: fs.readFileSync(output) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.meta.fileName).toBeNull();
    expect(res.payload.fileData!.toString()).toBe("piped payload");
    expect(parseFile("", fs.readFileSync(output))!.header.mode).toBe("file");
  });
});

describe("EncryptApp — iteration count", () => {
  it("uses an explicitly requested count verbatim", async () => {
    const output = path.join(dir, "explicit.zefer");
    await run(options({ output, textContent: "x", iterations: 123_456 }));
    expect(headerOf(output).iterations).toBe(123_456);
  });

  it.each([
    [1, 1_000_000],
    [300, 600_000],
    [900, 300_000],
  ])("benchmarks %i ms per 100k into %i iterations", async (ms, expected) => {
    benchmarkMs = ms;
    const output = path.join(dir, `bench-${ms}.zefer`);
    await run(options({ output, textContent: "x", iterations: 0 }));
    expect(headerOf(output).iterations).toBe(expected);
  }, 120_000);
});

describe("EncryptApp — security options", () => {
  it("turns a TTL in minutes into an absolute expiry inside the payload", async () => {
    const output = path.join(dir, "ttl.zefer");
    const before = Date.now();
    await run(options({ output, textContent: "x", ttl: 30 }));

    const res = await decodeZefer("", PASS, { rawBytes: fs.readFileSync(output) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.meta.expiresAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(res.payload.meta.expiresAt).toBeLessThan(Date.now() + 31 * 60_000);
  });

  it("leaves expiresAt at 0 when no TTL is given", async () => {
    const output = path.join(dir, "no-ttl.zefer");
    await run(options({ output, textContent: "x" }));
    const res = await decodeZefer("", PASS, { rawBytes: fs.readFileSync(output) });
    expect(res.ok && res.payload.meta.expiresAt).toBe(0);
  });

  it("carries the dual key, reveal key, question, attempts and IP list through", async () => {
    const output = path.join(dir, "full.zefer");
    await run(
      options({
        output,
        textContent: "guarded",
        secondPassphrase: "second",
        dualKey: true,
        revealKey: "reveal-key",
        question: "Pet?",
        questionAnswer: "firulais",
        maxAttempts: 3,
        allowedIps: ["10.0.0.1"],
        compression: "gzip",
      })
    );

    const buf = fs.readFileSync(output);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("ZEFR3");
    expect(headerOf(output).compression).toBe("gzip");

    const res = await decodeZefer("", "reveal-key", { rawBytes: buf, questionAnswer: "firulais" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.content).toBe("guarded");
    expect(res.payload.meta).toMatchObject({
      question: "Pet?",
      maxAttempts: 3,
      allowedIps: ["10.0.0.1"],
    });
  });
});

describe("EncryptApp — verbose panel", () => {
  it("lists every configured option while the operation runs", async () => {
    const output = path.join(dir, "verbose.zefer");
    const instance = render(
      <EncryptApp
        {...options({
          output,
          textContent: "x",
          verbose: true,
          hint: "two parts",
          note: "for Alice",
          question: "Pet?",
          questionAnswer: "firulais",
          ttl: 60,
          maxAttempts: 5,
          dualKey: true,
          secondPassphrase: "second",
          revealKey: "reveal-key",
          allowedIps: ["10.0.0.1", "::1"],
        })}
      />
    );

    const early = instance.frames.join("\n");
    expect(early).toContain("hint:         two parts");
    expect(early).toContain("note:         for Alice");
    expect(early).toContain("question:     Pet?");
    expect(early).toContain("expires:");
    expect(early).toContain("max attempts: 5");
    expect(early).toContain("dual-key mode enabled");
    expect(early).toContain("reveal key enabled (ZEFR3 format)");
    expect(early).toContain("allowed IPs:  10.0.0.1, ::1");

    await vi.waitFor(() => {
      if (!instance.lastFrame()!.includes(ICON_OK)) throw new Error("pending");
    }, { timeout: 30_000, interval: 10 });

    // Once finished, the panel is replaced by the result line.
    expect(instance.lastFrame()).not.toContain("dual-key mode enabled");
    instance.unmount();
  });

  it("omits every row that was not configured", async () => {
    const output = path.join(dir, "verbose-empty.zefer");
    const instance = render(
      <EncryptApp {...options({ output, textContent: "x", verbose: true })} />
    );
    const early = instance.frames.join("\n");
    expect(early).not.toContain("hint:");
    expect(early).not.toContain("expires:");
    expect(early).not.toContain("max attempts:");
    expect(early).not.toContain("dual-key mode enabled");
    expect(early).not.toContain("allowed IPs:");

    await vi.waitFor(() => {
      if (!instance.lastFrame()!.includes(ICON_OK)) throw new Error("pending");
    }, { timeout: 30_000, interval: 10 });
    instance.unmount();
  });
});
