/**
 * MCP stdio server — the JSON-RPC envelope and all five tools.
 *
 * Each case drives the real server loop over a fake stdin/stdout pair, so the
 * transport, the dispatch table and the handlers are all exercised together.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { startMcpServer } from "../server.js";
import { encodeZefer } from "../../lib/zefer.js";
import { encryptBytesToBase64 } from "../../lib/crypto.js";

const ITER = 1_000;
const PASS = "passphrase";
const VERSION = "1.4.0-test";
const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;
const realCwd = process.cwd();
let dir: string;

interface RpcResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: { content?: { type: string; text: string }[]; isError?: boolean } & Record<
    string,
    unknown
  >;
  error?: { code: number; message: string };
}

/** Feed raw lines through the server and collect the responses it writes. */
async function rpcRaw(lines: string[]): Promise<RpcResponse[]> {
  const input = new PassThrough();
  Object.defineProperty(process, "stdin", { value: input, configurable: true });

  const written: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });

  const finished = startMcpServer(VERSION);
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  await finished;

  spy.mockRestore();
  return written
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RpcResponse);
}

const rpc = (requests: unknown[]) => rpcRaw(requests.map((r) => JSON.stringify(r)));

/** Call one tool and return its parsed payload plus the isError flag. */
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const [res] = await rpc([{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }]);
  const text = res.result!.content![0].text;
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain-text error messages stay as-is */
  }
  return { text, parsed, isError: res.result!.isError === true };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zefer-mcp-"));
  process.chdir(dir);
});

afterAll(() => {
  process.chdir(realCwd);
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  Object.defineProperty(process, "stdin", realStdin);
});

// ─── Transport ───

describe("JSON-RPC envelope", () => {
  it("answers initialize with the server identity and the client's protocol version", async () => {
    const [res] = await rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    ]);
    expect(res.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "zefer-cli", version: VERSION },
    });
    expect(res.result!.instructions).toContain("AES-256-GCM");
  });

  it("falls back to the 2024-11-05 protocol version when the client omits it", async () => {
    const [res] = await rpc([{ jsonrpc: "2.0", id: 1, method: "initialize" }]);
    expect(res.result!.protocolVersion).toBe("2024-11-05");
  });

  it("answers ping with an empty result", async () => {
    const [res] = await rpc([{ jsonrpc: "2.0", id: "p", method: "ping" }]);
    expect(res).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
  });

  it("lists the five tools with their input schemas", async () => {
    const [res] = await rpc([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    const tools = res.result!.tools as { name: string; inputSchema: unknown }[];
    expect(tools.map((t) => t.name)).toEqual([
      "zefer_encrypt",
      "zefer_decrypt",
      "zefer_keygen",
      "zefer_analyze_password",
      "zefer_inspect",
    ]);
    expect(tools.every((t) => !!t.inputSchema)).toBe(true);
  });

  it("reports a parse error for a malformed line", async () => {
    const [res] = await rpcRaw(["{ not json"]);
    expect(res).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });

  it("ignores blank lines entirely", async () => {
    expect(await rpcRaw(["", "   "])).toEqual([]);
  });

  it("reports an unknown method when the request has an id", async () => {
    const [res] = await rpc([{ jsonrpc: "2.0", id: 7, method: "resources/list" }]);
    expect(res.error).toEqual({ code: -32601, message: "Method not found: resources/list" });
  });

  it("silently accepts notifications", async () => {
    expect(await rpc([{ jsonrpc: "2.0", method: "notifications/initialized" }])).toEqual([]);
  });

  it("normalizes a missing id to null in the reply", async () => {
    const [res] = await rpcRaw(['{"jsonrpc":"2.0","id":null,"method":"ping"}']);
    expect(res.id).toBeNull();
  });

  it("reports an unknown tool", async () => {
    const [res] = await rpc([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "zefer_nope" } },
    ]);
    expect(res.error).toEqual({ code: -32602, message: "Unknown tool: zefer_nope" });
  });

  it("wraps a handler failure as a tool error instead of crashing", async () => {
    const res = await callTool("zefer_encrypt", { passphrase: "longenough", inputPath: "\0" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Internal error: Invalid path");
  });

  it("swallows a failing notification without answering", async () => {
    expect(
      await rpc([
        {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "zefer_encrypt", arguments: { passphrase: "longenough", inputPath: "\0" } },
        },
      ])
    ).toEqual([]);
  });

  it("survives a line that is valid JSON but not a request object", async () => {
    // `null` parses cleanly, then has no `id`: the failure must stay inside the
    // request queue instead of tearing the server down.
    const responses = await rpcRaw(["null", JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" })]);
    expect(responses).toEqual([{ jsonrpc: "2.0", id: 9, result: {} }]);
  });

  it("answers several queued requests in order", async () => {
    const responses = await rpc([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "ping" },
    ]);
    expect(responses.map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

// ─── zefer_encrypt ───

describe("zefer_encrypt", () => {
  it("encrypts text to an explicit output path", async () => {
    const outputPath = path.join(dir, "text.zefer");
    const res = await callTool("zefer_encrypt", {
      text: "api_key=123",
      passphrase: PASS,
      outputPath,
      iterations: ITER,
      compression: "gzip",
    });

    expect(res.isError).toBe(false);
    expect(res.parsed).toMatchObject({ outputPath, format: "ZEFB3", expiresAt: "never" });
    expect(fs.readFileSync(outputPath).subarray(0, 5).toString("ascii")).toBe("ZEFB3");
  });

  it("defaults the output to encrypted.zefer for inline text", async () => {
    const res = await callTool("zefer_encrypt", { text: "x", passphrase: PASS, iterations: ITER });
    expect(res.parsed).toMatchObject({ outputPath: path.join(dir, "encrypted.zefer") });
  });

  it("defaults the output to <input>.zefer for a file and records its name", async () => {
    const inputPath = path.join(dir, "notes.md");
    fs.writeFileSync(inputPath, "# notes");

    const res = await callTool("zefer_encrypt", { inputPath, passphrase: PASS, iterations: ITER });
    expect(res.parsed).toMatchObject({ outputPath: `${inputPath}.zefer` });

    const decoded = await callTool("zefer_decrypt", {
      inputPath: `${inputPath}.zefer`,
      passphrase: PASS,
      outputPath: path.join(dir, "notes-out.md"),
    });
    expect(decoded.parsed).toMatchObject({ fileName: "notes.md", sizeBytes: 7 });
  });

  it("marks a reveal-key file as ZEFR3 and honours the TTL", async () => {
    const outputPath = path.join(dir, "reveal.zefer");
    const res = await callTool("zefer_encrypt", {
      text: "shared",
      passphrase: PASS,
      revealKey: "reveal-key",
      ttlMinutes: 60,
      iterations: ITER,
      outputPath,
    });
    expect(res.parsed).toMatchObject({ format: "ZEFR3" });
    expect((res.parsed as { expiresAt: string }).expiresAt).not.toBe("never");
    expect(fs.readFileSync(outputPath).subarray(0, 5).toString("ascii")).toBe("ZEFR3");
  });

  it("enables dual-key mode whenever a second passphrase is supplied", async () => {
    const outputPath = path.join(dir, "dual.zefer");
    await callTool("zefer_encrypt", {
      text: "two-person",
      passphrase: PASS,
      secondPassphrase: "second",
      iterations: ITER,
      outputPath,
    });

    const both = await callTool("zefer_decrypt", {
      inputPath: outputPath,
      passphrase: PASS,
      secondPassphrase: "second",
    });
    expect(both.parsed).toEqual({ content: "two-person" });

    const single = await callTool("zefer_decrypt", { inputPath: outputPath, passphrase: PASS });
    expect(single.isError).toBe(true);
  });

  it("stores the security metadata it is given", async () => {
    const outputPath = path.join(dir, "guarded.zefer");
    await callTool("zefer_encrypt", {
      text: "guarded",
      passphrase: PASS,
      question: "Pet?",
      questionAnswer: "firulais",
      maxAttempts: 3,
      allowedIps: ["10.0.0.1"],
      hint: "two parts",
      note: "for Alice",
      iterations: ITER,
      outputPath,
    });

    const res = await callTool("zefer_decrypt", {
      inputPath: outputPath,
      passphrase: PASS,
      questionAnswer: "firulais",
    });
    expect(res.parsed).toEqual({ content: "guarded" });
  });

  it.each([
    ["a passphrase shorter than 6 characters", { passphrase: "12345", text: "x" }, "at least 6 characters"],
    ["a non-string passphrase", { passphrase: { a: 1 }, text: "x" }, "at least 6 characters"],
    ["neither text nor inputPath", { passphrase: PASS }, "provide `text` or `inputPath`"],
    [
      "a question without an answer",
      { passphrase: PASS, text: "x", question: "Pet?" },
      "`questionAnswer` is required",
    ],
  ])("rejects %s", async (_label, args, message) => {
    const res = await callTool("zefer_encrypt", args as Record<string, unknown>);
    expect(res.isError).toBe(true);
    expect(res.text).toContain(message);
  });

  it("accepts a numeric passphrase by coercing it to a string", async () => {
    const outputPath = path.join(dir, "numeric.zefer");
    const res = await callTool("zefer_encrypt", {
      text: "x",
      passphrase: 1234567,
      iterations: ITER,
      outputPath,
    });
    expect(res.isError).toBe(false);

    const back = await callTool("zefer_decrypt", { inputPath: outputPath, passphrase: "1234567" });
    expect(back.parsed).toEqual({ content: "x" });
  });

  it("reports a missing input file", async () => {
    const res = await callTool("zefer_encrypt", {
      passphrase: PASS,
      inputPath: path.join(dir, "nope.txt"),
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("input file not found");
  });

  it("falls back to 600k PBKDF2 iterations when none is requested", async () => {
    const outputPath = path.join(dir, "default-iterations.zefer");
    await callTool("zefer_encrypt", { text: "x", passphrase: PASS, outputPath });

    const report = (await callTool("zefer_inspect", { inputPath: outputPath })).parsed as {
      header: { iterations: number };
    };
    expect(report.header.iterations).toBe(600_000);
  }, 120_000);
});

// ─── zefer_decrypt ───

describe("zefer_decrypt", () => {
  it("returns text content directly", async () => {
    const inputPath = path.join(dir, "back.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({
        content: "round trip",
        passphrase: PASS,
        fileName: null,
        expiresAt: 0,
        iterations: ITER,
      })
    );
    expect((await callTool("zefer_decrypt", { inputPath, passphrase: PASS })).parsed).toEqual({
      content: "round trip",
    });
  });

  it("returns an empty string for empty text content", async () => {
    const inputPath = path.join(dir, "empty.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({ content: "", passphrase: PASS, fileName: null, expiresAt: 0, iterations: ITER })
    );
    expect((await callTool("zefer_decrypt", { inputPath, passphrase: PASS })).parsed).toEqual({
      content: "",
    });
  });

  it("writes file payloads under the name stored in the payload", async () => {
    const inputPath = path.join(dir, "named.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({
        fileData: Buffer.from("payload bytes"),
        passphrase: PASS,
        fileName: "doc.bin",
        expiresAt: 0,
        iterations: ITER,
      })
    );

    const res = await callTool("zefer_decrypt", { inputPath, passphrase: PASS });
    expect(res.parsed).toMatchObject({
      writtenTo: path.join(dir, "doc.bin"),
      fileName: "doc.bin",
      sizeBytes: 13,
    });
  });

  it("confines a hostile payload file name to the working directory", async () => {
    const inputPath = path.join(dir, "hostile.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({
        fileData: Buffer.from("evil"),
        passphrase: PASS,
        fileName: "../../../escape.bin",
        expiresAt: 0,
        iterations: ITER,
      })
    );

    const res = await callTool("zefer_decrypt", { inputPath, passphrase: PASS });
    expect(res.parsed).toMatchObject({ writtenTo: path.join(dir, "escape.bin") });
    expect(fs.existsSync(path.join(dir, "..", "..", "..", "escape.bin"))).toBe(false);
  });

  it("falls back to decrypted.bin when the payload has no file name", async () => {
    const inputPath = path.join(dir, "anon.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({
        fileData: Buffer.from("anon"),
        passphrase: PASS,
        fileName: null,
        expiresAt: 0,
        iterations: ITER,
      })
    );

    const res = await callTool("zefer_decrypt", { inputPath, passphrase: PASS });
    expect(res.parsed).toMatchObject({ writtenTo: path.join(dir, "decrypted.bin") });
  });

  it("refuses to clobber an existing output unless overwrite is set", async () => {
    const inputPath = path.join(dir, "clobber.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({
        fileData: Buffer.from("new bytes"),
        passphrase: PASS,
        fileName: "target.bin",
        expiresAt: 0,
        iterations: ITER,
      })
    );
    fs.writeFileSync(path.join(dir, "target.bin"), "old bytes");

    const refused = await callTool("zefer_decrypt", { inputPath, passphrase: PASS });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("pass overwrite: true");
    expect(fs.readFileSync(path.join(dir, "target.bin"), "utf-8")).toBe("old bytes");

    const forced = await callTool("zefer_decrypt", { inputPath, passphrase: PASS, overwrite: true });
    expect(forced.isError).toBe(false);
    expect(fs.readFileSync(path.join(dir, "target.bin"), "utf-8")).toBe("new bytes");
  });

  it("reports a missing file and a wrong passphrase", async () => {
    const missing = await callTool("zefer_decrypt", {
      inputPath: path.join(dir, "gone.zefer"),
      passphrase: PASS,
    });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("file not found");

    const inputPath = path.join(dir, "locked.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({ content: "x", passphrase: PASS, fileName: null, expiresAt: 0, iterations: ITER })
    );
    const wrong = await callTool("zefer_decrypt", { inputPath, passphrase: "nope" });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain("Decryption failed: wrong_passphrase");
  });
});

// ─── zefer_keygen ───

describe("zefer_keygen", () => {
  it("defaults to one 64-character secure key with a score", async () => {
    const res = await callTool("zefer_keygen");
    const payload = res.parsed as {
      mode: string;
      length: number;
      count: number;
      keys: { value: string; score: number; scoreLabel: string; effectiveEntropyBits: number }[];
    };
    expect(payload).toMatchObject({ mode: "secure", length: 64, count: 1 });
    expect(payload.keys).toHaveLength(1);
    expect([...payload.keys[0].value]).toHaveLength(64);
    expect(payload.keys[0].scoreLabel).toBe("strong");
  });

  it("honours the advanced options and returns keys strongest first", async () => {
    const res = await callTool("zefer_keygen", {
      mode: "base58",
      length: 24,
      count: 5,
      groupSize: 6,
      excludeAmbiguous: true,
      requireAllClasses: true,
      noRepeats: true,
      excludeChars: "z",
    });
    const payload = res.parsed as { keys: { value: string; effectiveEntropyBits: number }[] };
    expect(payload.keys).toHaveLength(5);
    for (const key of payload.keys) {
      expect(key.value).toMatch(/^[^-]{6}-[^-]{6}-[^-]{6}-[^-]{6}$/);
      expect(key.value).not.toContain("z");
    }
    const bits = payload.keys.map((k) => k.effectiveEntropyBits);
    expect(bits).toEqual([...bits].sort((a, b) => b - a));
  });

  it("labels uuid mode instead of a character count", async () => {
    const res = await callTool("zefer_keygen", { mode: "uuid" });
    expect(res.parsed).toMatchObject({ mode: "uuid", length: "uuid-v7" });
  });

  it("clamps the length and count into their supported ranges", async () => {
    const res = await callTool("zefer_keygen", { mode: "pin", length: 99_999, count: 0 });
    const payload = res.parsed as { length: number; count: number; keys: unknown[] };
    expect(payload).toMatchObject({ length: 2048, count: 1 });
    expect(payload.keys).toHaveLength(1);
  });

  it("rejects an unknown mode", async () => {
    const res = await callTool("zefer_keygen", { mode: "morse" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('invalid mode "morse"');
  });
});

// ─── zefer_analyze_password ───

describe("zefer_analyze_password", () => {
  it("reports the full breakdown for a strong password", async () => {
    const res = await callTool("zefer_analyze_password", { password: "Kq7#mZr2$vXp9!Lw" });
    const report = res.parsed as Record<string, unknown>;
    expect(report).toMatchObject({ score: 4, scoreLabel: "strong", length: 16, estimatedAlphabet: 95 });
    expect(report.warnings).toEqual([]);
    expect(String(report.vsAverageHumanPassword)).toContain("more combinations");
    expect(Object.keys(report.crackTimeByScenario as object)).toHaveLength(4);
    expect(report.compliance).toMatchObject({ nist: "pass", owasp: "pass" });
  });

  it("reports weaknesses and a below-average verdict for a leaked password", async () => {
    const res = await callTool("zefer_analyze_password", { password: "password" });
    const report = res.parsed as Record<string, unknown>;
    expect(report).toMatchObject({ score: 0, scoreLabel: "very weak" });
    expect(report.warnings).toContain("common");
    expect(report.vsAverageHumanPassword).toBe("below the average human password (~40 bits)");
    expect(report.compliance).toMatchObject({ aes128: "fail", quantum: "fail" });
    expect(Object.values(report.crackTimeByScenario as Record<string, string>)).toContain("instant");
  });

  it("treats a missing or non-string password as the empty string", async () => {
    const res = await callTool("zefer_analyze_password", { password: ["nope"] });
    expect(res.parsed).toMatchObject({ length: 0, score: 0 });
  });

  it("renders mid-range crack times as plain counts", async () => {
    const res = await callTool("zefer_analyze_password", { password: "Zmvkspn9!qTr4" });
    const times = Object.values(
      (res.parsed as { crackTimeByScenario: Record<string, string> }).crackTimeByScenario
    );
    expect(times.some((t) => /^[\d,]+ (seconds|minutes|hours|days|months|years)$/.test(t))).toBe(true);
    expect(times.some((t) => t.startsWith("~10^"))).toBe(true);
  });
});

// ─── zefer_inspect ───

describe("zefer_inspect", () => {
  it("describes a ZEFB3 container without the passphrase", async () => {
    const inputPath = path.join(dir, "inspect.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({
        content: "zefer".repeat(30_000),
        passphrase: PASS,
        fileName: null,
        expiresAt: 0,
        iterations: 1_000_000,
      })
    );

    const report = (await callTool("zefer_inspect", { inputPath })).parsed as Record<string, unknown>;
    expect(report).toMatchObject({ file: "inspect.zefer", format: "ZEFB3 (binary, single key)" });
    expect(report.header).toMatchObject({ mode: "text", iterations: 1_000_000, kdfLevel: "maximum" });

    const structure = report.structure as Record<string, unknown>;
    expect(structure.valid).toBe(true);
    expect(structure.encryptedChunks).toBe(1);
    expect(Number(structure.ciphertextEntropyBitsPerByte)).toBeGreaterThan(7.9);
    expect(String(structure.saltHex)).toHaveLength(64);
    expect(String(structure.baseIvHex)).toHaveLength(24);
    expect(String(report.sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(report.observations).toBe("none — the file follows best practices");
    expect(Object.keys(report.kdfResistance as object)).toHaveLength(6);
  }, 120_000);

  it("names the high KDF tier and lists hint, note and reveal observations", async () => {
    const inputPath = path.join(dir, "inspect-reveal.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({
        content: "zefer".repeat(30_000),
        passphrase: PASS,
        revealKey: "reveal-key",
        hint: "two parts",
        note: "for Alice",
        compression: "gzip",
        fileName: null,
        expiresAt: 0,
        iterations: 600_000,
      })
    );

    const report = (await callTool("zefer_inspect", { inputPath })).parsed as Record<string, unknown>;
    expect(report.format).toBe("ZEFR3 (binary, with reveal key)");
    expect(report.header).toMatchObject({ kdfLevel: "high", hint: "two parts", note: "for Alice" });

    const texts = (report.observations as { severity: string; text: string }[]).map((o) => o.text);
    expect(texts).toEqual([
      "Public hint visible without the passphrase",
      "Public note visible to anyone holding the file",
      "Reveal key included: two valid passphrases can decrypt",
      "Compression enabled: ciphertext size may hint at content compressibility",
    ]);
    expect((report.structure as { encryptedChunks: number }).encryptedChunks).toBe(2);
  }, 120_000);

  it("warns about a standard KDF and skips entropy for a small sample", async () => {
    const inputPath = path.join(dir, "inspect-small.zefer");
    fs.writeFileSync(
      inputPath,
      await encodeZefer({ content: "tiny", passphrase: PASS, fileName: null, expiresAt: 0, iterations: ITER })
    );

    const report = (await callTool("zefer_inspect", { inputPath })).parsed as Record<string, unknown>;
    expect(report.header).toMatchObject({ kdfLevel: "standard" });
    expect((report.structure as { ciphertextEntropyBitsPerByte: null }).ciphertextEntropyBitsPerByte).toBeNull();
    expect((report.observations as { text: string }[])[0].text).toContain("KDF at standard level");
    expect(String((report.kdfResistance as Record<string, string>)["6 common chars (~28 bits)"])).toBe(
      "instant"
    );
  });

  it("flags a container whose chunk framing is broken and whose bytes are not random", async () => {
    const header = Buffer.from(
      JSON.stringify({ iterations: 600_000, compression: "none", hint: null, note: null, mode: "file" }),
      "utf-8"
    );
    const len = Buffer.alloc(4);
    len.writeUInt32BE(header.length, 0);
    const chunkLen = Buffer.alloc(4);
    chunkLen.writeUInt32BE(100, 0);
    const inputPath = path.join(dir, "inspect-broken.zefer");
    fs.writeFileSync(
      inputPath,
      Buffer.concat([
        Buffer.from("ZEFB3", "ascii"),
        len,
        header,
        Buffer.alloc(44),
        chunkLen,
        Buffer.alloc(100),
        Buffer.alloc(2048),
      ])
    );

    const report = (await callTool("zefer_inspect", { inputPath })).parsed as Record<string, unknown>;
    expect((report.structure as { valid: boolean }).valid).toBe(false);
    const texts = (report.observations as { severity: string; text: string }[]).map((o) => o.text);
    expect(texts[0]).toContain("Internal structure does not match");
    expect(texts[1]).toContain("Ciphertext randomness unusually low");
  });

  it("flags a container too short to hold even one chunk", async () => {
    const header = Buffer.from(JSON.stringify({ iterations: 600_000, compression: "none" }), "utf-8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(header.length, 0);
    const inputPath = path.join(dir, "inspect-tiny.zefer");
    fs.writeFileSync(
      inputPath,
      Buffer.concat([Buffer.from("ZEFB3", "ascii"), len, header, Buffer.alloc(50)])
    );

    const report = (await callTool("zefer_inspect", { inputPath })).parsed as Record<string, unknown>;
    const structure = report.structure as Record<string, unknown>;
    expect(structure).toMatchObject({
      valid: false,
      encryptedChunks: 0,
      estimatedContentBytes: 0,
      ciphertextEntropyBitsPerByte: null,
    });
  });

  it("describes a legacy text container with no binary structure", async () => {
    const line = await encryptBytesToBase64(Buffer.from("legacy"), PASS, ITER);
    const inputPath = path.join(dir, "legacy.zefer");
    fs.writeFileSync(
      inputPath,
      ["ZEFER3", JSON.stringify({ iterations: 600_000, compression: "none", mode: "text" }), line].join("\n")
    );

    const report = (await callTool("zefer_inspect", { inputPath })).parsed as Record<string, unknown>;
    expect(report.format).toBe("legacy text");
    expect(report.structure).toBeNull();
    expect(report.observations).toBe("none — the file follows best practices");
  });

  it("reports a missing file and a file that is not a container", async () => {
    const missing = await callTool("zefer_inspect", { inputPath: path.join(dir, "gone.zefer") });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("file not found");

    const junk = path.join(dir, "junk.bin");
    fs.writeFileSync(junk, "not a zefer file at all");
    const invalid = await callTool("zefer_inspect", { inputPath: junk });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toContain("no known magic");
  });
});
