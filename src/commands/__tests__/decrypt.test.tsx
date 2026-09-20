/**
 * `zefer decrypt` — output routing (stdout, explicit path, payload file name),
 * the overwrite guard, the verbose header preview and every failure message.
 */

import React from "react";
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { render } from "ink-testing-library";
import { DecryptApp, type DecryptOptions } from "../decrypt.js";
import { encodeZefer } from "../../lib/zefer.js";
import { ICON_OK, ICON_ERR } from "../../utils/terminal.js";

const ITER = 1_000;
const PASS = "passphrase";
const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;
const realCwd = process.cwd();
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zefer-decrypt-"));
  process.chdir(dir); // payload-supplied file names resolve against the cwd
});

afterAll(() => {
  process.chdir(realCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__zefer_stdout_content;
});

afterEach(() => {
  Object.defineProperty(process, "stdin", realStdin);
});

function options(overrides: Partial<DecryptOptions> = {}): DecryptOptions {
  return { input: "-", passphrase: PASS, force: false, verbose: false, ...overrides };
}

async function run(opts: DecryptOptions): Promise<string> {
  const instance = render(<DecryptApp {...opts} />);
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

/** Write a freshly encrypted container into the scratch directory. */
async function fixture(name: string, opts: Parameters<typeof encodeZefer>[0]): Promise<string> {
  const file = path.join(dir, name);
  fs.writeFileSync(file, await encodeZefer({ iterations: ITER, ...opts }));
  return file;
}

/** Ink hard-wraps long lines; collapse whitespace before matching prose. */
const flat = (frame: string) => frame.replace(/\s+/g, " ");

const stdoutContent = () => (globalThis as Record<string, unknown>).__zefer_stdout_content;

describe("DecryptApp — text payloads", () => {
  it("stages the text for stdout when no output path is given", async () => {
    const input = await fixture("text.zefer", {
      content: "the secret",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
    });

    const frame = await run(options({ input }));
    expect(frame).toContain(ICON_OK);
    expect(frame).toContain("stdout (10 B)");
    expect(stdoutContent()).toBe("the secret");
  });

  it("writes the text to an explicit output path instead", async () => {
    const input = await fixture("text2.zefer", {
      content: "written out",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
    });
    const output = path.join(dir, "out.txt");

    const frame = await run(options({ input, output }));
    expect(frame).toContain("out.txt (11 B)");
    expect(fs.readFileSync(output, "utf-8")).toBe("written out");
    expect(stdoutContent()).toBeUndefined();
  });

  it("refuses to overwrite an existing text output without --force", async () => {
    const input = await fixture("text3.zefer", {
      content: "x",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
    });
    const output = path.join(dir, "taken.txt");
    fs.writeFileSync(output, "original");

    const frame = await run(options({ input, output }));
    expect(frame).toContain(ICON_ERR);
    expect(flat(frame)).toContain("already exists. Use --force to overwrite.");
    expect(fs.readFileSync(output, "utf-8")).toBe("original");
  });

  it("overwrites with --force", async () => {
    const input = await fixture("text4.zefer", {
      content: "replacement",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
    });
    const output = path.join(dir, "taken2.txt");
    fs.writeFileSync(output, "original");

    const frame = await run(options({ input, output, force: true }));
    expect(frame).toContain(ICON_OK);
    expect(fs.readFileSync(output, "utf-8")).toBe("replacement");
  });
});

describe("DecryptApp — file payloads", () => {
  it("writes the payload under its own name, confined to the working directory", async () => {
    const input = await fixture("file.zefer", {
      fileData: Buffer.from([1, 2, 3, 4]),
      passphrase: PASS,
      fileName: "../../escape.bin", // hostile name inside the encrypted payload
      expiresAt: 0,
    });

    const frame = await run(options({ input }));
    expect(frame).toContain(ICON_OK);
    expect(frame).toContain("escape.bin (4 B)");
    expect(fs.existsSync(path.join(dir, "escape.bin"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "..", "..", "escape.bin"))).toBe(false);
  });

  it("falls back to <input>.dec when the payload carries no file name", async () => {
    const input = await fixture("nameless.zefer", {
      fileData: Buffer.from("bytes"),
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
    });

    const frame = await run(options({ input }));
    expect(frame).toContain("nameless.zefer.dec (5 B)");
    expect(fs.readFileSync(`${input}.dec`).toString()).toBe("bytes");
  });

  it("honours an explicit output path for file payloads", async () => {
    const input = await fixture("file2.zefer", {
      fileData: Buffer.from("bytes"),
      passphrase: PASS,
      fileName: "original.bin",
      expiresAt: 0,
    });
    const output = path.join(dir, "renamed.bin");

    await run(options({ input, output }));
    expect(fs.readFileSync(output).toString()).toBe("bytes");
  });

  it("refuses to overwrite an existing file output without --force", async () => {
    const input = await fixture("file3.zefer", {
      fileData: Buffer.from("new"),
      passphrase: PASS,
      fileName: "collide.bin",
      expiresAt: 0,
    });
    fs.writeFileSync(path.join(dir, "collide.bin"), "old");

    const frame = await run(options({ input }));
    expect(frame).toContain(ICON_ERR);
    expect(flat(frame)).toContain("already exists");
    expect(fs.readFileSync(path.join(dir, "collide.bin"), "utf-8")).toBe("old");
  });
});

describe("DecryptApp — stdin input", () => {
  it("reads the container from a pipe and labels the header 'stdin'", async () => {
    const buf = await encodeZefer({
      content: "from a pipe",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    Object.defineProperty(process, "stdin", {
      value: Readable.from([buf]),
      configurable: true,
    });

    const instance = render(<DecryptApp {...options({ input: "-", verbose: true })} />);
    await vi.waitFor(() => {
      if (!instance.lastFrame()!.includes(ICON_OK)) throw new Error("pending");
    }, { timeout: 30_000, interval: 10 });

    expect(instance.lastFrame()).toContain("stdin");
    expect(stdoutContent()).toBe("from a pipe");
    instance.unmount();
  });
});

describe("DecryptApp — unusual containers", () => {
  it("writes nothing when the header declares an unknown mode", async () => {
    // The mode string is swapped for another four-character value, so every
    // offset in the container stays valid and only the routing changes.
    const buf = await encodeZefer({
      content: "unrouted",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
      iterations: ITER,
    });
    const headerLen = buf.readUInt32BE(5);
    const patched = Buffer.from(buf);
    patched.write(
      buf.subarray(9, 9 + headerLen).toString("utf-8").replace('"mode":"text"', '"mode":"fake"'),
      9,
      "utf-8"
    );
    const input = path.join(dir, "fake-mode.zefer");
    fs.writeFileSync(input, patched);

    const frame = await run(options({ input }));
    expect(frame).toContain(ICON_OK);
    expect(frame).not.toContain("stdout");
    expect(stdoutContent()).toBeUndefined();
  });

  it("opens a dual-key container only with both halves", async () => {
    const input = await fixture("dual.zefer", {
      content: "two-person",
      passphrase: "first",
      secondPassphrase: "second",
      dualKey: true,
      fileName: null,
      expiresAt: 0,
    });

    const ok = await run(options({ input, passphrase: "first", secondPassphrase: "second" }));
    expect(ok).toContain(ICON_OK);
    expect(stdoutContent()).toBe("two-person");

    const bad = await run(options({ input, passphrase: "first" }));
    expect(bad).toContain("Wrong passphrase");
  });
});

describe("DecryptApp — failures", () => {
  it("rejects a file that is not a zefer container", async () => {
    const input = path.join(dir, "not-zefer.txt");
    fs.writeFileSync(input, "just text");
    const frame = await run(options({ input }));
    expect(frame).toContain("Invalid or unrecognized .zefer file format");
  });

  it("reports a missing input file", async () => {
    const frame = await run(options({ input: path.join(dir, "missing.zefer") }));
    expect(frame).toContain(ICON_ERR);
    expect(frame).toContain("ENOENT");
  });

  it("reports a wrong passphrase", async () => {
    const input = await fixture("wrong.zefer", {
      content: "x",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
    });
    expect(await run(options({ input, passphrase: "nope" }))).toContain("Wrong passphrase");
  });

  it("reports an expired file", async () => {
    const input = await fixture("expired.zefer", {
      content: "x",
      passphrase: PASS,
      fileName: null,
      expiresAt: Date.now() - 1_000,
    });
    expect(await run(options({ input }))).toContain("This file has expired");
  });

  it("asks for the secret answer and rejects a wrong one", async () => {
    const input = await fixture("question.zefer", {
      content: "x",
      passphrase: PASS,
      question: "Pet?",
      questionAnswer: "firulais",
      fileName: null,
      expiresAt: 0,
    });

    expect(await run(options({ input }))).toContain("Secret question required");
    expect(await run(options({ input, questionAnswer: "rex" }))).toContain(
      "Wrong secret question answer"
    );
    expect(await run(options({ input, questionAnswer: "Firulais" }))).toContain(ICON_OK);
  });
});

describe("DecryptApp — verbose header preview", () => {
  it("shows every public header field before decrypting", async () => {
    const input = await fixture("verbose.zefer", {
      content: "zefer ".repeat(100),
      passphrase: PASS,
      hint: "two parts",
      note: "for Alice",
      compression: "gzip",
      fileName: null,
      expiresAt: 0,
    });

    const instance = render(<DecryptApp {...options({ input, verbose: true })} />);
    const early = instance.frames.join("\n");
    expect(early).toContain("hint:");
    expect(early).toContain("two parts");
    expect(early).toContain("note:");
    expect(early).toContain("for Alice");
    expect(early).toContain("mode:");
    expect(early).toContain("iterations:");
    expect(early).toContain("compressed:");
    expect(early).toContain("gzip");
    expect(early).toContain("verbose.zefer"); // subtitle is the base name

    await vi.waitFor(() => {
      if (!instance.lastFrame()!.includes(ICON_OK)) throw new Error("pending");
    }, { timeout: 30_000, interval: 10 });
    instance.unmount();
  });

  it("omits the hint, note and compression rows when they are unset", async () => {
    const input = await fixture("verbose-plain.zefer", {
      content: "x",
      passphrase: PASS,
      fileName: null,
      expiresAt: 0,
    });

    const instance = render(<DecryptApp {...options({ input, verbose: true })} />);
    const early = instance.frames.join("\n");
    expect(early).toContain("iterations:");
    expect(early).not.toContain("hint:");
    expect(early).not.toContain("note:");
    expect(early).not.toContain("compressed:");

    await vi.waitFor(() => {
      if (!instance.lastFrame()!.includes(ICON_OK)) throw new Error("pending");
    }, { timeout: 30_000, interval: 10 });
    instance.unmount();
  });

  it("renders no preview for an unreadable or non-zefer input", async () => {
    const missing = await run(options({ input: path.join(dir, "gone.zefer"), verbose: true }));
    expect(missing).toContain(ICON_ERR);
    expect(missing).not.toContain("iterations:");

    const junk = path.join(dir, "junk.bin");
    fs.writeFileSync(junk, "not a container");
    const invalid = await run(options({ input: junk, verbose: true }));
    expect(invalid).toContain("Invalid or unrecognized");
    expect(invalid).not.toContain("iterations:");
  });
});
