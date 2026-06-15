/**
 * MCP server — exposes every zefer capability as Model Context Protocol tools
 * over stdio (newline-delimited JSON-RPC 2.0, the standard MCP transport).
 *
 * Dependency-free by design so the standalone binaries keep working.
 *
 * Started explicitly with `zefer mcp`, or auto-detected: when the binary is
 * launched with no arguments and stdin is a pipe (how MCP clients spawn
 * servers), it speaks MCP instead of printing terminal help.
 *
 * Tools: zefer_encrypt, zefer_decrypt, zefer_keygen,
 *        zefer_analyze_password, zefer_inspect
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as nodeCrypto from "crypto";
import { encodeZefer, decodeZefer, parseFile } from "../lib/zefer.js";
import type { CompressionMethod } from "../lib/compression.js";
import {
  MODES,
  generateWithOptions,
  analyzePassword,
  crackBucketFor,
  toSuperscript,
  complianceOf,
  keyspaceExponent,
  ATTACK_SCENARIOS,
  AVERAGE_HUMAN_BITS,
  type KeygenMode,
} from "../lib/passwords.js";

// ─── JSON-RPC plumbing ───

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id: RpcRequest["id"], result: unknown): void {
  send({ jsonrpc: "2.0", id: id ?? null, result });
}

function replyError(id: RpcRequest["id"], code: number, message: string): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function toolText(payload: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
    isError,
  };
}

// ─── Shared helpers (mirror `zefer info` deep analysis) ───

function walkChunks(data: Buffer): { ok: boolean; chunks: number; ciphertext: number } {
  if (data.length < 44 + 4 + 17) return { ok: false, chunks: 0, ciphertext: 0 };
  let off = 44;
  let chunks = 0;
  let ciphertext = 0;
  while (off + 4 <= data.length) {
    const len = data.readUInt32BE(off);
    off += 4;
    if (len < 17 || off + len > data.length) return { ok: false, chunks, ciphertext };
    chunks++;
    ciphertext += len;
    off += len;
  }
  return { ok: off === data.length && chunks > 0, chunks, ciphertext };
}

function shannonEntropy(bytes: Buffer): number {
  if (bytes.length === 0) return 0;
  const freq = new Array<number>(256).fill(0);
  for (let i = 0; i < bytes.length; i++) freq[bytes[i]]++;
  let h = 0;
  for (const f of freq) {
    if (f > 0) {
      const p = f / bytes.length;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

function crackLabel(bits: number, gps: number): string {
  const { bucket, value } = crackBucketFor(bits, gps);
  if (bucket === "instant") return "instant";
  if (bucket === "yearsExp") return `~10^${value} years (≈10${toSuperscript(value)})`;
  return `${value.toLocaleString("en-US")} ${bucket}`;
}

function fullPasswordReport(password: string) {
  const a = analyzePassword(password);
  return {
    score: a.score,
    scoreLabel: ["very weak", "weak", "fair", "good", "strong"][a.score],
    length: a.length,
    estimatedAlphabet: a.poolSize,
    maxEntropyBits: a.entropyBits,
    effectiveEntropyBits: a.effectiveBits,
    totalKeyspace: `~10^${keyspaceExponent(a.effectiveBits)}`,
    postQuantumBits: Math.floor(a.effectiveBits / 2),
    characterClasses: a.classes,
    warnings: a.warnings,
    crackTimeByScenario: Object.fromEntries(
      ATTACK_SCENARIOS.map((s) => [`${s.key} (${s.expLabel}/s)`, crackLabel(a.effectiveBits, s.gps)])
    ),
    compliance: Object.fromEntries(
      complianceOf(a.effectiveBits, a.length).map((c) => [c.key, c.pass ? "pass" : "fail"])
    ),
    vsAverageHumanPassword:
      a.effectiveBits > AVERAGE_HUMAN_BITS
        ? `~10^${Math.floor((a.effectiveBits - AVERAGE_HUMAN_BITS) * Math.log10(2))}x more combinations than a ~${AVERAGE_HUMAN_BITS}-bit human password`
        : "below the average human password (~40 bits)",
  };
}

// ─── Tool definitions ───

const TOOLS = [
  {
    name: "zefer_encrypt",
    description:
      "Encrypt text or a file into a password-protected .zefer file (AES-256-GCM, PBKDF2-SHA256). " +
      "Provide either `text` or `inputPath`. Example: { text: 'api_key=123', passphrase: 'my-strong-pass', outputPath: 'secret.zefer', ttlMinutes: 1440, compression: 'gzip' }",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to encrypt (alternative to inputPath)" },
        inputPath: { type: "string", description: "Path of the file to encrypt (alternative to text)" },
        outputPath: { type: "string", description: "Output .zefer path (default: <input>.zefer or encrypted.zefer)" },
        passphrase: { type: "string", description: "Passphrase (min 6 chars)" },
        secondPassphrase: { type: "string", description: "Second passphrase (dual-key, two-person authorization)" },
        revealKey: { type: "string", description: "Reveal key — recipients can decrypt without the main passphrase (ZEFR3)" },
        hint: { type: "string", description: "Public hint (visible without the passphrase)" },
        note: { type: "string", description: "Public note (visible without the passphrase)" },
        question: { type: "string", description: "Secret question" },
        questionAnswer: { type: "string", description: "Secret question answer (required with question)" },
        ttlMinutes: { type: "number", description: "Expiration in minutes (0 = never)" },
        iterations: { type: "number", description: "PBKDF2 iterations (default 600000)" },
        compression: { type: "string", enum: ["none", "gzip", "deflate", "deflate-raw"], description: "Compression before encryption" },
        maxAttempts: { type: "number", description: "Max decryption attempts (0 = unlimited)" },
        allowedIps: { type: "array", items: { type: "string" }, description: "IPv4/IPv6 allowlist (stored encrypted)" },
      },
      required: ["passphrase"],
    },
  },
  {
    name: "zefer_decrypt",
    description:
      "Decrypt a .zefer file. Text content is returned directly; file content is written to outputPath (or the original name). " +
      "Example: { inputPath: 'secret.zefer', passphrase: 'my-strong-pass' }",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string", description: "Path of the .zefer file" },
        passphrase: { type: "string", description: "Passphrase (or reveal key)" },
        secondPassphrase: { type: "string", description: "Second passphrase (dual-key files)" },
        questionAnswer: { type: "string", description: "Secret-question answer if the file requires it" },
        outputPath: { type: "string", description: "Where to write decrypted file content (file mode)" },
        overwrite: { type: "boolean", description: "Overwrite outputPath if it exists (default false)" },
      },
      required: ["inputPath", "passphrase"],
    },
  },
  {
    name: "zefer_keygen",
    description:
      "Generate cryptographically secure keys (CSPRNG + rejection sampling, zero modulo bias) with per-key strength analysis. " +
      "Modes: unicode|secure|alpha|hex|base58|pin|uuid. Example: { mode: 'base58', length: 24, count: 3, groupSize: 6 }",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: MODES.map((m) => m.key), description: "Key alphabet (default: secure)" },
        length: { type: "number", description: "Length in characters, 1-2048 (default 64; ignored for uuid)" },
        count: { type: "number", description: "Number of keys, 1-50 (default 1)" },
        excludeAmbiguous: { type: "boolean", description: "Exclude ambiguous characters (0 O 1 l I)" },
        excludeChars: { type: "string", description: "Additional characters to exclude" },
        requireAllClasses: { type: "boolean", description: "Guarantee lower/upper/digit/symbol when available" },
        noRepeats: { type: "boolean", description: "Never the same character twice in a row" },
        groupSize: { type: "number", description: "Insert a dash every N characters (cosmetic)" },
      },
    },
  },
  {
    name: "zefer_analyze_password",
    description:
      "Full security report for a password: effective entropy, crack time across 4 attack scenarios (10^2-10^15 guesses/s), " +
      "NIST SP 800-63B / OWASP / AES-128 / post-quantum (Grover) compliance, keyspace, weaknesses and comparison vs an average human password. " +
      "Example: { password: 'Tr0ub4dor&3' }",
    inputSchema: {
      type: "object",
      properties: {
        password: { type: "string", description: "Password to analyze (never stored or transmitted)" },
      },
      required: ["password"],
    },
  },
  {
    name: "zefer_inspect",
    description:
      "Deep security analysis of a .zefer file WITHOUT the passphrase: public header (format, KDF level, compression, hint/note), " +
      "structural integrity, chunk count, ciphertext randomness (Shannon entropy), salt/IV, SHA-256 fingerprint, " +
      "KDF resistance table and severity-tagged observations. Example: { inputPath: 'secret.zefer' }",
    inputSchema: {
      type: "object",
      properties: {
        inputPath: { type: "string", description: "Path of the .zefer file" },
      },
      required: ["inputPath"],
    },
  },
];

// ─── Tool handlers ───

async function handleEncrypt(args: Record<string, unknown>) {
  const passphrase = String(args.passphrase ?? "");
  if (passphrase.length < 6) return toolText("Error: passphrase must be at least 6 characters", true);

  const text = args.text as string | undefined;
  const inputPath = args.inputPath as string | undefined;
  if (!text && !inputPath) return toolText("Error: provide `text` or `inputPath`", true);
  if (args.question && !args.questionAnswer) return toolText("Error: `questionAnswer` is required with `question`", true);

  let fileData: Buffer | undefined;
  let fileName: string | null = null;
  let fileType: string | undefined;
  if (inputPath) {
    if (!fs.existsSync(inputPath)) return toolText(`Error: input file not found: ${inputPath}`, true);
    fileData = fs.readFileSync(inputPath);
    fileName = path.basename(inputPath);
    fileType = "application/octet-stream";
  }

  const ttl = Number(args.ttlMinutes ?? 0);
  const out = (args.outputPath as string | undefined) ?? (inputPath ? `${inputPath}.zefer` : "encrypted.zefer");

  const buf = await encodeZefer({
    content: text,
    fileData,
    passphrase,
    secondPassphrase: args.secondPassphrase as string | undefined,
    revealKey: args.revealKey as string | undefined,
    fileName,
    fileType,
    expiresAt: ttl > 0 ? Date.now() + ttl * 60_000 : 0,
    hint: args.hint as string | undefined,
    note: args.note as string | undefined,
    question: args.question as string | undefined,
    questionAnswer: args.questionAnswer as string | undefined,
    maxAttempts: Number(args.maxAttempts ?? 0),
    iterations: Number(args.iterations ?? 600_000),
    dualKey: !!args.secondPassphrase,
    compression: (args.compression as CompressionMethod | undefined) ?? "none",
    allowedIps: (args.allowedIps as string[] | undefined) ?? [],
  });

  fs.writeFileSync(out, buf);
  return toolText({
    outputPath: path.resolve(out),
    sizeBytes: buf.length,
    format: args.revealKey ? "ZEFR3" : "ZEFB3",
    expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 60_000).toISOString() : "never",
  });
}

async function handleDecrypt(args: Record<string, unknown>) {
  const inputPath = String(args.inputPath ?? "");
  if (!fs.existsSync(inputPath)) return toolText(`Error: file not found: ${inputPath}`, true);

  const rawBytes = fs.readFileSync(inputPath);
  const fileContent = rawBytes.toString("utf-8");
  const result = await decodeZefer(fileContent, String(args.passphrase ?? ""), {
    secondPassphrase: args.secondPassphrase as string | undefined,
    questionAnswer: args.questionAnswer as string | undefined,
    rawBytes,
    maxDecompressSize: 0, // MCP: no size cap — process any local file
  });

  if (!result.ok) return toolText(`Decryption failed: ${result.error}`, true);

  const { payload } = result;
  if (payload.fileData) {
    const out = (args.outputPath as string | undefined) ?? payload.meta.fileName ?? "decrypted.bin";
    if (fs.existsSync(out) && !args.overwrite) {
      return toolText(`Error: ${out} exists — pass overwrite: true to replace it`, true);
    }
    fs.writeFileSync(out, payload.fileData);
    return toolText({
      writtenTo: path.resolve(out),
      fileName: payload.meta.fileName,
      sizeBytes: payload.fileData.length,
    });
  }

  return toolText({ content: payload.content ?? "" });
}

function handleKeygen(args: Record<string, unknown>) {
  const mode = (args.mode as KeygenMode | undefined) ?? "secure";
  if (!MODES.some((m) => m.key === mode)) {
    return toolText(`Error: invalid mode "${mode}". Valid: ${MODES.map((m) => m.key).join("|")}`, true);
  }
  const length = Math.min(2048, Math.max(1, Number(args.length ?? 64)));
  const count = Math.min(50, Math.max(1, Number(args.count ?? 1)));

  const keys = Array.from({ length: count }, () => {
    const value = generateWithOptions(mode, length, {
      excludeAmbiguous: !!args.excludeAmbiguous,
      excludeChars: args.excludeChars as string | undefined,
      requireAllClasses: !!args.requireAllClasses,
      noRepeats: !!args.noRepeats,
      groupSize: Number(args.groupSize ?? 0),
    });
    const a = analyzePassword(value);
    return {
      value,
      score: a.score,
      scoreLabel: ["very weak", "weak", "fair", "good", "strong"][a.score],
      effectiveEntropyBits: a.effectiveBits,
    };
  }).sort((a, b) => b.score - a.score || b.effectiveEntropyBits - a.effectiveEntropyBits);

  return toolText({ mode, length: mode === "uuid" ? "uuid-v7" : length, count, keys });
}

function handleInspect(args: Record<string, unknown>) {
  const inputPath = String(args.inputPath ?? "");
  if (!fs.existsSync(inputPath)) return toolText(`Error: file not found: ${inputPath}`, true);

  const rawBytes = fs.readFileSync(inputPath);
  const parsed = parseFile(rawBytes.toString("utf-8", 0, Math.min(rawBytes.length, 64 * 1024)), rawBytes);
  if (!parsed) return toolText("Not a valid .zefer file (no known magic: ZEFB3/ZEFR3/ZEFER3/ZEFER2)", true);

  const { header } = parsed;
  const main = parsed.binaryData ? walkChunks(parsed.binaryData) : null;
  const reveal = parsed.revealBinaryData ? walkChunks(parsed.revealBinaryData) : null;
  const sample = parsed.binaryData?.subarray(44, Math.min(parsed.binaryData.length, 44 + 64 * 1024));
  const entropy = sample && sample.length >= 1024 ? shannonEntropy(sample) : null;
  const guessesPerGpu = Math.max(1, Math.round(1e10 / (2 * header.iterations)));

  const observations: { severity: string; text: string }[] = [];
  if (main && !(main.ok && (reveal === null || reveal.ok)))
    observations.push({ severity: "danger", text: "Internal structure does not match the declared format (corrupted or truncated)" });
  if (entropy !== null && entropy < 7.5)
    observations.push({ severity: "danger", text: "Ciphertext randomness unusually low — corrupted or not real ciphertext" });
  if (header.iterations < 600_000)
    observations.push({ severity: "warning", text: "KDF at standard level — consider 600k or 1M iterations for sensitive data" });
  if (header.hint) observations.push({ severity: "warning", text: "Public hint visible without the passphrase" });
  if (header.note) observations.push({ severity: "info", text: "Public note visible to anyone holding the file" });
  if (parsed.revealBinaryData) observations.push({ severity: "info", text: "Reveal key included: two valid passphrases can decrypt" });
  if (header.compression && header.compression !== "none")
    observations.push({ severity: "info", text: "Compression enabled: ciphertext size may hint at content compressibility" });

  return toolText({
    file: path.basename(inputPath),
    sizeBytes: rawBytes.length,
    format: parsed.revealBinaryData ? "ZEFR3 (binary, with reveal key)" : parsed.binary ? "ZEFB3 (binary, single key)" : "legacy text",
    header: {
      mode: header.mode,
      iterations: header.iterations,
      kdfLevel: header.iterations >= 1_000_000 ? "maximum" : header.iterations >= 600_000 ? "high" : "standard",
      compression: header.compression,
      hint: header.hint,
      note: header.note,
    },
    structure: main
      ? {
          valid: main.ok && (reveal === null || reveal.ok),
          encryptedChunks: main.chunks + (reveal?.chunks ?? 0),
          estimatedContentBytes: Math.max(0, main.ciphertext - 16 * main.chunks),
          ciphertextEntropyBitsPerByte: entropy !== null ? Number(entropy.toFixed(2)) : null,
          saltHex: parsed.binaryData!.subarray(0, 32).toString("hex"),
          baseIvHex: parsed.binaryData!.subarray(32, 44).toString("hex"),
        }
      : null,
    sha256: nodeCrypto.createHash("sha256").update(rawBytes).digest("hex"),
    kdfResistance: {
      guessesPerSecondPerGpu: guessesPerGpu,
      fleetModel: "1,000 GPUs",
      "6 common chars (~28 bits)": crackLabel(28, guessesPerGpu * 1000),
      "8 mixed chars (~45 bits)": crackLabel(45, guessesPerGpu * 1000),
      "12 mixed chars (~72 bits)": crackLabel(72, guessesPerGpu * 1000),
      "64-char generated (~400 bits)": crackLabel(400, guessesPerGpu * 1000),
    },
    observations: observations.length > 0 ? observations : "none — the file follows best practices",
    protectedMetadata:
      "Expiration, IP restriction, secret question and max attempts live inside the AES-256-GCM ciphertext and cannot be read without the passphrase.",
  });
}

// ─── Server loop ───

export async function startMcpServer(version: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  // Serialize request handling: lines are processed strictly in order and the
  // server only exits after every queued request has been answered.
  let queue: Promise<void> = Promise.resolve();

  async function handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: RpcRequest;
    try {
      req = JSON.parse(trimmed) as RpcRequest;
    } catch {
      replyError(null, -32700, "Parse error");
      return;
    }

    const isNotification = req.id === undefined;

    try {
      switch (req.method) {
        case "initialize":
          reply(req.id, {
            protocolVersion: (req.params?.protocolVersion as string) ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "zefer-cli", version },
            instructions:
              "zefer exposes client-side AES-256-GCM encryption tools: encrypt/decrypt .zefer files, " +
              "generate scored passwords, analyze password strength and inspect .zefer files without the passphrase. " +
              "Everything runs locally — no network, no telemetry.",
          });
          break;

        case "ping":
          reply(req.id, {});
          break;

        case "tools/list":
          reply(req.id, { tools: TOOLS });
          break;

        case "tools/call": {
          const name = req.params?.name as string;
          const args = (req.params?.arguments as Record<string, unknown>) ?? {};
          let result;
          switch (name) {
            case "zefer_encrypt": result = await handleEncrypt(args); break;
            case "zefer_decrypt": result = await handleDecrypt(args); break;
            case "zefer_keygen": result = handleKeygen(args); break;
            case "zefer_analyze_password": result = toolText(fullPasswordReport(String(args.password ?? ""))); break;
            case "zefer_inspect": result = handleInspect(args); break;
            default:
              replyError(req.id, -32602, `Unknown tool: ${name}`);
              return;
          }
          reply(req.id, result);
          break;
        }

        default:
          // Notifications (e.g. notifications/initialized) are silently accepted
          if (!isNotification) replyError(req.id, -32601, `Method not found: ${req.method}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isNotification) reply(req.id, toolText(`Internal error: ${msg}`, true));
    }
  }

  rl.on("line", (line) => {
    queue = queue.then(() => handleLine(line)).catch(() => {});
  });

  // Keep the process alive until stdin closes AND all queued requests finish
  await new Promise<void>((resolve) => rl.on("close", resolve));
  await queue;
}
