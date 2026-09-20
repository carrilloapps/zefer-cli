/**
 * Zefer binary format encoder/decoder — Node.js port.
 *
 * Supports all formats:
 *   ZEFB3 — binary, single key
 *   ZEFR3 — binary, single key + reveal key (dual-block)
 *   ZEFER3 — legacy text format (read-only)
 *   ZEFER2 — legacy text format (read-only)
 *
 * Files produced by this CLI are fully compatible with the zefer web app.
 */

import { performance } from "node:perf_hooks";
import { hashAnswer, combineDualKeys, decryptFromBase64 } from "./crypto.js";
import { chunkedEncrypt, chunkedDecryptToBuffer, CHUNK_SIZE } from "./chunked-crypto.js";
import { compressBytes, decompressBytes, MAX_DECOMPRESS_SIZE, type CompressionMethod } from "./compression.js";
import { getAttempts, setAttempts, removeAttempts } from "./attempts.js";

const MAGIC_TEXT = "ZEFER3";
const MAGIC_BIN = Buffer.from([0x5a, 0x45, 0x46, 0x42, 0x33]); // "ZEFB3"
const MAGIC_BIN_REVEAL = Buffer.from([0x5a, 0x45, 0x46, 0x52, 0x33]); // "ZEFR3"

// ─── Public header (not encrypted — visible without passphrase) ───

export interface ZeferHeader {
  iterations: number;
  compression: CompressionMethod;
  hint: string | null;
  note: string | null;
  mode: "text" | "file";
}

// ─── Encrypted metadata (inside the encrypted payload) ───

export interface ZeferMeta {
  v: 3;
  fileName: string | null;
  fileType: string | null;
  fileSize: number;
  expiresAt: number; // Unix ms, 0 = never
  createdAt: number; // Unix ms
  answerHash: string | null;
  allowedIps: string[];
  question: string | null;
  maxAttempts: number; // 0 = unlimited
}

function isValidMeta(obj: unknown): obj is ZeferMeta {
  if (!obj || typeof obj !== "object") return false;
  const m = obj as Record<string, unknown>;
  return (
    m.v === 3 &&
    typeof m.expiresAt === "number" &&
    typeof m.createdAt === "number" &&
    typeof m.maxAttempts === "number" &&
    typeof m.fileSize === "number" &&
    Array.isArray(m.allowedIps)
  );
}

// ─── Result types ───

export interface ZeferPayload {
  meta: ZeferMeta;
  content: string | null;
  fileData: Buffer | null;
}

export type DecodeError =
  | "invalid_format"
  | "wrong_passphrase"
  | "expired"
  | "wrong_answer"
  | "max_attempts"
  | "ip_blocked"
  | "needs_answer";

export type DecodeResult =
  | { ok: true; payload: ZeferPayload; header: ZeferHeader }
  | { ok: false; error: DecodeError };

// ─── Parsed file (intermediate, before decryption) ───

export interface ParsedFile {
  header: ZeferHeader;
  binary: boolean;
  /** Base64 lines of a legacy text container; empty for binary containers. */
  encryptedLines: string[];
  binaryData?: Buffer; // ZEFB3 / ZEFR3 main block
  revealBinaryData?: Buffer; // ZEFR3 reveal block
}

// ─── Encode options ───

export interface EncodeOptions {
  content?: string;
  fileData?: Buffer;
  passphrase: string;
  secondPassphrase?: string;
  revealKey?: string;
  fileName: string | null;
  fileType?: string;
  expiresAt: number;
  hint?: string;
  note?: string;
  question?: string;
  questionAnswer?: string;
  maxAttempts?: number;
  iterations?: number;
  dualKey?: boolean;
  compression?: CompressionMethod;
  allowedIps?: string[];
  onProgress?: {
    compressing: (percent: number) => void;
    compressingDone: () => void;
    deriving: () => void;
    derivingDone: () => void;
    encrypting: (chunkIndex: number, totalChunks: number) => void;
    packaging: () => void;
  };
}

// ─── Sanitize public strings ───

function sanitize(s: string | undefined): string | null {
  const v = s?.trim();
  if (!v) return null;
  return v.replace(/[<>"'&]/g, "");
}

// ─── Encode ───

/** A 4-byte big-endian length prefix. */
function uint32(value: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

/** Build the encrypted-side metadata block. */
function buildMeta(opts: EncodeOptions, fileSize: number, answerHash: string | null): ZeferMeta {
  return {
    v: 3,
    fileName: opts.fileName,
    fileType: opts.fileType ?? null,
    fileSize,
    expiresAt: opts.expiresAt,
    createdAt: Date.now(),
    answerHash,
    allowedIps: opts.allowedIps ?? [],
    question: opts.question?.trim() ?? null,
    maxAttempts: opts.maxAttempts ?? 0,
  };
}

/** One encrypted block: salt(32) + baseIv(12) + length-prefixed chunks. */
type EncryptedBlock = Awaited<ReturnType<typeof chunkedEncrypt>>;

function blockSize(block: EncryptedBlock): number {
  return block.chunks.reduce((total, chunk) => total + chunk.length, 32 + 12);
}

/**
 * Lay out the on-disk container. Byte layout is shared with the web app and
 * must not change:
 *   ZEFB3: magic + headerLen + header + salt + baseIv + chunks
 *   ZEFR3: magic + headerLen + header + mainBlockSize + mainBlock + revealBlock
 */
function assembleFile(
  headerBytes: Buffer,
  main: EncryptedBlock,
  reveal: EncryptedBlock | null
): Buffer {
  const magic = reveal ? MAGIC_BIN_REVEAL : MAGIC_BIN;
  const parts: Buffer[] = [magic, uint32(headerBytes.length), headerBytes];

  if (reveal) parts.push(uint32(blockSize(main)));
  parts.push(main.salt, main.baseIv, ...main.chunks);
  if (reveal) parts.push(reveal.salt, reveal.baseIv, ...reveal.chunks);

  return Buffer.concat(parts);
}

export async function encodeZefer(opts: EncodeOptions): Promise<Buffer> {
  const iterations = opts.iterations ?? 600_000;
  const compressionMethod = opts.compression ?? "none";
  const revealKey = opts.revealKey?.trim();
  const isFile = !!opts.fileData;

  const header: ZeferHeader = {
    iterations,
    compression: compressionMethod,
    hint: sanitize(opts.hint),
    note: sanitize(opts.note),
    mode: isFile ? "file" : "text",
  };

  const answerHash =
    opts.question && opts.questionAnswer ? await hashAnswer(opts.questionAnswer) : null;

  const rawData: Buffer = isFile
    ? opts.fileData!
    : Buffer.from(opts.content ?? "", "utf-8");

  const meta = buildMeta(opts, rawData.length, answerHash);

  // Compress before encryption
  opts.onProgress?.compressing(0);
  const dataToEncrypt =
    compressionMethod === "none" ? rawData : await compressBytes(rawData, compressionMethod);
  opts.onProgress?.compressingDone();

  // Pack: [4-byte meta length][meta JSON][data bytes]
  const metaBytes = Buffer.from(JSON.stringify(meta), "utf-8");
  const combined = Buffer.concat([uint32(metaBytes.length), metaBytes, dataToEncrypt]);

  const mainPassphrase =
    opts.dualKey && opts.secondPassphrase
      ? combineDualKeys(opts.passphrase, opts.secondPassphrase)
      : opts.passphrase;

  // `combined` always carries the metadata block, so it is never empty.
  const estimatedChunks = Math.ceil(combined.length / CHUNK_SIZE);
  const grandTotal = estimatedChunks * (revealKey ? 2 : 1);

  opts.onProgress?.deriving();
  const main = await chunkedEncrypt(combined, mainPassphrase, iterations, (ci) => {
    if (ci === 1) opts.onProgress?.derivingDone();
    opts.onProgress?.encrypting(ci, grandTotal);
  });

  const reveal = revealKey
    ? await chunkedEncrypt(combined, revealKey, iterations, (ci) => {
        opts.onProgress?.encrypting(estimatedChunks + ci, grandTotal);
      })
    : null;

  opts.onProgress?.packaging();

  return assembleFile(Buffer.from(JSON.stringify(header), "utf-8"), main, reveal);
}

// ─── Parse ───

/**
 * Which binary container the leading bytes announce.
 * `ZEF?3` where `?` is `B` (single key) or `R` (reveal key).
 */
function binaryKind(rawBytes?: Buffer): "main" | "reveal" | null {
  if (!rawBytes || rawBytes.length < 5) return null;
  const magic = rawBytes.subarray(0, 5);
  const wellFormed =
    magic[0] === 0x5a && magic[1] === 0x45 && magic[2] === 0x46 && magic[4] === 0x33;
  if (!wellFormed) return null;
  if (magic[3] === 0x52) return "reveal"; // 'R' = ZEFR3
  if (magic[3] === 0x42) return "main"; // 'B' = ZEFB3
  return null;
}

function parseBinary(rawBytes: Buffer, kind: "main" | "reveal"): ParsedFile | null {
  try {
    const headerLen = rawBytes.readUInt32BE(5);
    const header = JSON.parse(rawBytes.subarray(9, 9 + headerLen).toString("utf-8")) as ZeferHeader;
    if (!header.mode) header.mode = "file";

    const dataOffset = 9 + headerLen;
    if (kind === "main") {
      return { header, binary: true, encryptedLines: [], binaryData: rawBytes.subarray(dataOffset) };
    }

    const mainBlockSize = rawBytes.readUInt32BE(dataOffset);
    const mainStart = dataOffset + 4;
    return {
      header,
      binary: true,
      encryptedLines: [],
      binaryData: rawBytes.subarray(mainStart, mainStart + mainBlockSize),
      revealBinaryData: rawBytes.subarray(mainStart + mainBlockSize),
    };
  } catch {
    return null;
  }
}

/** Legacy text containers: ZEFER3 / ZEFER2, magic on line 1, header JSON on line 2. */
function parseText(fileContent: string): ParsedFile | null {
  const lines = fileContent.trim().split("\n");
  if (lines.length < 3) return null;
  if (lines[0] !== MAGIC_TEXT && lines[0] !== "ZEFER2") return null;

  try {
    const header = JSON.parse(lines[1]) as ZeferHeader;
    if (!header.mode) header.mode = "text";
    return { header, binary: false, encryptedLines: lines.slice(2) };
  } catch {
    return null;
  }
}

export function parseFile(fileContent: string, rawBytes?: Buffer): ParsedFile | null {
  const kind = binaryKind(rawBytes);
  if (kind) return parseBinary(rawBytes!, kind);
  return parseText(fileContent);
}

// ─── Internal decryption helpers ───

async function tryDecryptText(
  encryptedLines: string[],
  passphrase: string,
  header: ZeferHeader
): Promise<{ meta: ZeferMeta; rawData: Buffer } | null> {
  for (const line of encryptedLines) {
    try {
      const decrypted = await decryptFromBase64(line, passphrase, header.iterations);
      return extractPayload(decrypted);
    } catch {
      continue;
    }
  }
  return null;
}

async function tryDecryptBinary(
  data: Buffer,
  passphrase: string,
  header: ZeferHeader,
  onChunkProgress?: (ci: number, tc: number) => void
): Promise<{ meta: ZeferMeta; rawData: Buffer } | null> {
  if (data.length < 44) return null;
  const salt = data.subarray(0, 32);
  const baseIv = data.subarray(32, 44);
  const encryptedChunks = data.subarray(44);

  try {
    const decrypted = await chunkedDecryptToBuffer(
      encryptedChunks,
      salt,
      baseIv,
      passphrase,
      header.iterations,
      onChunkProgress
    );
    return extractPayload(decrypted);
  } catch {
    return null;
  }
}

type Extracted = { meta: ZeferMeta; rawData: Buffer };

/** Current format: [4-byte meta length][meta JSON][data]. */
function readPrefixedPayload(decrypted: Buffer): Extracted | null {
  if (decrypted.length < 4) return null;
  const metaLength = decrypted.readUInt32BE(0);
  if (metaLength <= 0 || metaLength + 4 > decrypted.length) return null;

  try {
    const meta = JSON.parse(decrypted.subarray(4, 4 + metaLength).toString("utf-8"));
    return isValidMeta(meta) ? { meta, rawData: decrypted.subarray(4 + metaLength) } : null;
  } catch {
    return null;
  }
}

/** Null-byte separator (older ZEFER3): [meta JSON]\0[data]. */
function readNullSeparatedPayload(decrypted: Buffer): Extracted | null {
  const sepIndex = decrypted.indexOf(0);
  if (sepIndex <= 0 || sepIndex >= decrypted.length - 1) return null;

  try {
    const meta = JSON.parse(decrypted.subarray(0, sepIndex).toString("utf-8"));
    return isValidMeta(meta) ? { meta, rawData: decrypted.subarray(sepIndex + 1) } : null;
  } catch {
    return null;
  }
}

/** Legacy ZEFER2 — one JSON document holding both metadata and content. */
function readLegacyPayload(decrypted: Buffer): Extracted | null {
  try {
    const legacy = JSON.parse(decrypted.toString("utf-8"));
    const meta: ZeferMeta = {
      v: 3,
      fileName: legacy.fileName,
      fileType: null,
      fileSize: 0,
      expiresAt: legacy.expiresAt,
      createdAt: legacy.createdAt,
      answerHash: legacy.answerHash,
      allowedIps: legacy.allowedIps ?? [],
      question: legacy.question ?? null,
      maxAttempts: legacy.maxAttempts ?? 0,
    };
    return { meta, rawData: Buffer.from(legacy.content ?? "", "utf-8") };
  } catch {
    return null;
  }
}

/** Try each payload layout, newest first. */
function extractPayload(decrypted: Buffer): Extracted | null {
  return (
    readPrefixedPayload(decrypted) ??
    readNullSeparatedPayload(decrypted) ??
    readLegacyPayload(decrypted)
  );
}

// ─── Decode ───

interface DecodeProgress {
  deriving: () => void;
  derivingDone: () => void;
  decrypting: (chunkIndex: number, totalChunks: number) => void;
  decompressing: () => void;
  verifying: () => void;
}

/**
 * Try every passphrase candidate against every block in the file: the main
 * block first, then the reveal block of a ZEFR3 file.
 */
async function decryptWithCandidates(
  parsed: ParsedFile,
  candidates: string[],
  onProgress?: DecodeProgress
): Promise<Extracted | null> {
  const { header } = parsed;
  const onChunk = (ci: number, tc: number) => {
    if (ci === 1) onProgress?.derivingDone();
    onProgress?.decrypting(ci, tc);
  };

  // Exactly one of the two is populated by `parseFile`: a binary container has
  // its blocks, a legacy text container its base64 lines. Walking both keeps
  // the loop free of container-kind branching.
  const blocks = [parsed.binaryData, parsed.revealBinaryData].filter((b): b is Buffer => !!b);

  for (const candidate of candidates) {
    for (const block of blocks) {
      const result = await tryDecryptBinary(block, candidate, header, onChunk);
      if (result) return result;
    }

    const fromText = await tryDecryptText(parsed.encryptedLines, candidate, header);
    if (fromText) {
      onProgress?.derivingDone();
      return fromText;
    }
  }
  return null;
}

/**
 * Enforce the security metadata carried inside the encrypted payload:
 * attempt counter, secret question, expiration. Returns the blocking error, or
 * `null` when the payload may be released.
 */
async function checkPayloadGuards(
  meta: ZeferMeta,
  attemptKey: string | null,
  questionAnswer?: string
): Promise<DecodeError | null> {
  if (attemptKey && getAttempts(attemptKey) >= meta.maxAttempts) return "max_attempts";

  if (meta.answerHash && meta.question) {
    if (!questionAnswer) return "needs_answer";
    if ((await hashAnswer(questionAnswer)) !== meta.answerHash) {
      if (attemptKey) setAttempts(attemptKey, getAttempts(attemptKey) + 1);
      return "wrong_answer";
    }
  }

  if (meta.expiresAt > 0 && Date.now() > meta.expiresAt) return "expired";

  return null;
}

export async function decodeZefer(
  fileContent: string,
  passphrase: string,
  options?: {
    secondPassphrase?: string;
    questionAnswer?: string;
    rawBytes?: Buffer;
    /**
     * Decompression-bomb cap in bytes. Defaults to {@link MAX_DECOMPRESS_SIZE}
     * (512 MB) — the safety net for the **library** channel. Pass `0` to remove
     * the cap entirely; the CLI and MCP channels do this so a real, locally
     * trusted file is never rejected for being large.
     */
    maxDecompressSize?: number;
    onProgress?: DecodeProgress;
  }
): Promise<DecodeResult> {
  const parsed = parseFile(fileContent, options?.rawBytes);
  if (!parsed) return { ok: false, error: "invalid_format" };

  const { header } = parsed;
  const { secondPassphrase, questionAnswer, onProgress } = options ?? {};

  const candidates = secondPassphrase
    ? [passphrase, combineDualKeys(passphrase, secondPassphrase)]
    : [passphrase];

  const startTime = performance.now();
  const MIN_RESPONSE_MS = 100; // timing-attack mitigation

  onProgress?.deriving();
  const result = await decryptWithCandidates(parsed, candidates, onProgress);

  if (!result) {
    const elapsed = performance.now() - startTime;
    if (elapsed < MIN_RESPONSE_MS) {
      await new Promise<void>((r) => setTimeout(r, MIN_RESPONSE_MS - elapsed));
    }
    return { ok: false, error: "wrong_passphrase" };
  }

  const { meta, rawData } = result;

  // Attempt tracking (file-based, mirrors localStorage in the web app)
  const attemptKey =
    meta.maxAttempts > 0 ? (parsed.encryptedLines[0] ?? "bin").substring(0, 40) : null;

  const blocked = await checkPayloadGuards(meta, attemptKey, questionAnswer);
  if (blocked) return { ok: false, error: blocked };

  // Clear attempt counter on success
  if (attemptKey) removeAttempts(attemptKey);

  // Decompress
  onProgress?.decompressing();
  const finalData =
    header.compression === "none"
      ? rawData
      : await decompressBytes(
          rawData,
          header.compression,
          options?.maxDecompressSize ?? MAX_DECOMPRESS_SIZE
        );

  onProgress?.verifying();

  const isFile = header.mode === "file";
  const payload: ZeferPayload = {
    meta,
    content: isFile ? null : finalData.toString("utf-8"),
    fileData: isFile ? finalData : null,
  };

  return { ok: true, payload, header };
}
