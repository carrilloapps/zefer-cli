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

import { performance } from "perf_hooks";
import { hashAnswer, combineDualKeys, decryptFromBase64 } from "./crypto.js";
import { chunkedEncrypt, chunkedDecryptToBuffer, CHUNK_SIZE } from "./chunked-crypto.js";
import { compressBytes, decompressBytes, type CompressionMethod } from "./compression.js";
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
  encryptedLines?: string[]; // text format
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

export async function encodeZefer(opts: EncodeOptions): Promise<Buffer> {
  const iterations = opts.iterations ?? 600_000;
  const compressionMethod = opts.compression ?? "none";
  const dualKey = opts.dualKey ?? false;
  const hasRevealKey = !!opts.revealKey?.trim();
  const isFile = !!opts.fileData;

  const header: ZeferHeader = {
    iterations,
    compression: compressionMethod,
    hint: sanitize(opts.hint),
    note: sanitize(opts.note),
    mode: isFile ? "file" : "text",
  };

  let answerHash: string | null = null;
  if (opts.question && opts.questionAnswer) {
    answerHash = await hashAnswer(opts.questionAnswer);
  }

  const rawData: Buffer = isFile
    ? opts.fileData!
    : Buffer.from(opts.content ?? "", "utf-8");

  const meta: ZeferMeta = {
    v: 3,
    fileName: opts.fileName,
    fileType: opts.fileType ?? null,
    fileSize: rawData.length,
    expiresAt: opts.expiresAt,
    createdAt: Date.now(),
    answerHash,
    allowedIps: opts.allowedIps ?? [],
    question: opts.question?.trim() ?? null,
    maxAttempts: opts.maxAttempts ?? 0,
  };

  // Compress before encryption
  opts.onProgress?.compressing(0);
  let dataToEncrypt: Buffer;
  if (compressionMethod !== "none") {
    dataToEncrypt = await compressBytes(rawData, compressionMethod);
  } else {
    dataToEncrypt = rawData;
  }
  opts.onProgress?.compressingDone();

  // Pack: [4-byte meta length][meta JSON][data bytes]
  const metaBytes = Buffer.from(JSON.stringify(meta), "utf-8");
  const lengthPrefix = Buffer.allocUnsafe(4);
  lengthPrefix.writeUInt32BE(metaBytes.length, 0);
  const combined = Buffer.concat([lengthPrefix, metaBytes, dataToEncrypt]);

  const mainPassphrase =
    dualKey && opts.secondPassphrase
      ? combineDualKeys(opts.passphrase, opts.secondPassphrase)
      : opts.passphrase;

  const headerJson = JSON.stringify(header);
  const estimatedChunks = Math.ceil(combined.length / CHUNK_SIZE) || 1;
  const grandTotal = estimatedChunks * (hasRevealKey ? 2 : 1);

  opts.onProgress?.deriving();
  const result = await chunkedEncrypt(
    combined,
    mainPassphrase,
    iterations,
    (ci, tc) => {
      if (ci === 1) opts.onProgress?.derivingDone();
      opts.onProgress?.encrypting(ci, grandTotal);
    }
  );

  const revealResult = hasRevealKey
    ? await chunkedEncrypt(combined, opts.revealKey!.trim(), iterations, (ci) => {
        opts.onProgress?.encrypting(estimatedChunks + ci, grandTotal);
      })
    : null;

  opts.onProgress?.packaging();

  const headerBytes = Buffer.from(headerJson, "utf-8");
  const headerLenBuf = Buffer.allocUnsafe(4);
  headerLenBuf.writeUInt32BE(headerBytes.length, 0);

  const magic = revealResult ? MAGIC_BIN_REVEAL : MAGIC_BIN;
  const parts: Buffer[] = [magic, headerLenBuf, headerBytes];

  if (revealResult) {
    // ZEFR3: [mainBlockSize (4)][mainBlock][revealBlock]
    let mainBlockSize = 32 + 12; // salt + baseIv
    for (const chunk of result.chunks) mainBlockSize += chunk.length;

    const mainBlockSizeBuf = Buffer.allocUnsafe(4);
    mainBlockSizeBuf.writeUInt32BE(mainBlockSize, 0);
    parts.push(mainBlockSizeBuf);

    parts.push(result.salt);
    parts.push(result.baseIv);
    for (const chunk of result.chunks) parts.push(chunk);

    parts.push(revealResult.salt);
    parts.push(revealResult.baseIv);
    for (const chunk of revealResult.chunks) parts.push(chunk);
  } else {
    // ZEFB3: [salt][baseIv][chunks...]
    parts.push(result.salt);
    parts.push(result.baseIv);
    for (const chunk of result.chunks) parts.push(chunk);
  }

  return Buffer.concat(parts);
}

// ─── Parse ───

export function parseFile(fileContent: string, rawBytes?: Buffer): ParsedFile | null {
  if (rawBytes && rawBytes.length >= 5) {
    const magic = rawBytes.subarray(0, 5);
    const isBinMagic =
      magic[0] === 0x5a &&
      magic[1] === 0x45 &&
      magic[2] === 0x46 &&
      magic[4] === 0x33;
    const isReveal = magic[3] === 0x52; // 'R' = ZEFR3

    if (isBinMagic && (magic[3] === 0x42 || isReveal)) {
      const headerLen = rawBytes.readUInt32BE(5);
      const headerStr = rawBytes.subarray(9, 9 + headerLen).toString("utf-8");
      try {
        const header = JSON.parse(headerStr) as ZeferHeader;
        if (!header.mode) header.mode = "file";
        const dataOffset = 9 + headerLen;

        if (isReveal) {
          const mainBlockSize = rawBytes.readUInt32BE(dataOffset);
          const mainStart = dataOffset + 4;
          return {
            header,
            binary: true,
            binaryData: rawBytes.subarray(mainStart, mainStart + mainBlockSize),
            revealBinaryData: rawBytes.subarray(mainStart + mainBlockSize),
          };
        }

        return {
          header,
          binary: true,
          binaryData: rawBytes.subarray(dataOffset),
        };
      } catch {
        return null;
      }
    }
  }

  // Text format (ZEFER3 / ZEFER2)
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

// ─── Internal decryption helpers ───

async function tryDecryptText(
  encryptedLines: string[],
  passphrase: string,
  header: ZeferHeader
): Promise<{ meta: ZeferMeta; rawData: Buffer } | null> {
  for (const line of encryptedLines) {
    try {
      const decrypted = await decryptFromBase64(line, passphrase, header.iterations);
      return extractPayload(decrypted, header);
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
    return await extractPayload(decrypted, header);
  } catch {
    return null;
  }
}

async function extractPayload(
  decrypted: Buffer,
  _header: ZeferHeader
): Promise<{ meta: ZeferMeta; rawData: Buffer } | null> {
  // Current format: [4-byte meta length][meta JSON][data]
  if (decrypted.length >= 4) {
    const metaLength = decrypted.readUInt32BE(0);
    if (metaLength > 0 && metaLength + 4 <= decrypted.length) {
      try {
        const metaStr = decrypted.subarray(4, 4 + metaLength).toString("utf-8");
        const testMeta = JSON.parse(metaStr);
        if (isValidMeta(testMeta)) {
          return { meta: testMeta, rawData: decrypted.subarray(4 + metaLength) };
        }
      } catch { /* try next */ }
    }
  }

  // Null-byte separator (older ZEFER3)
  const sepIndex = decrypted.indexOf(0);
  if (sepIndex > 0 && sepIndex < decrypted.length - 1) {
    try {
      const metaStr = decrypted.subarray(0, sepIndex).toString("utf-8");
      const testMeta = JSON.parse(metaStr);
      if (isValidMeta(testMeta)) {
        return { meta: testMeta, rawData: decrypted.subarray(sepIndex + 1) };
      }
    } catch { /* try next */ }
  }

  // Legacy ZEFER2 — full JSON payload
  try {
    const text = decrypted.toString("utf-8");
    const legacy = JSON.parse(text);
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

// ─── Decode ───

export async function decodeZefer(
  fileContent: string,
  passphrase: string,
  options?: {
    secondPassphrase?: string;
    questionAnswer?: string;
    rawBytes?: Buffer;
    onProgress?: {
      deriving: () => void;
      derivingDone: () => void;
      decrypting: (chunkIndex: number, totalChunks: number) => void;
      decompressing: () => void;
      verifying: () => void;
    };
  }
): Promise<DecodeResult> {
  const parsed = parseFile(fileContent, options?.rawBytes);
  if (!parsed) return { ok: false, error: "invalid_format" };

  const { header } = parsed;
  const { secondPassphrase, questionAnswer } = options ?? {};

  const candidates: string[] = [passphrase];
  if (secondPassphrase) {
    candidates.push(combineDualKeys(passphrase, secondPassphrase));
  }

  const startTime = performance.now();
  const MIN_RESPONSE_MS = 100; // timing-attack mitigation

  let result: { meta: ZeferMeta; rawData: Buffer } | null = null;

  options?.onProgress?.deriving();

  for (const candidate of candidates) {
    if (parsed.binary && parsed.binaryData) {
      result = await tryDecryptBinary(parsed.binaryData, candidate, header, (ci, tc) => {
        if (ci === 1) options?.onProgress?.derivingDone();
        options?.onProgress?.decrypting(ci, tc);
      });
      if (!result && parsed.revealBinaryData) {
        result = await tryDecryptBinary(
          parsed.revealBinaryData,
          candidate,
          header,
          (ci, tc) => {
            if (ci === 1) options?.onProgress?.derivingDone();
            options?.onProgress?.decrypting(ci, tc);
          }
        );
      }
    } else if (parsed.encryptedLines) {
      result = await tryDecryptText(parsed.encryptedLines, candidate, header);
      if (result) options?.onProgress?.derivingDone();
    }
    if (result) break;
  }

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
    meta.maxAttempts > 0
      ? `${(parsed.encryptedLines?.[0] ?? "bin").substring(0, 40)}`
      : null;

  if (attemptKey) {
    const attempts = getAttempts(attemptKey);
    if (attempts >= meta.maxAttempts) return { ok: false, error: "max_attempts" };
  }

  // Secret question check
  if (meta.answerHash && meta.question) {
    if (!questionAnswer) return { ok: false, error: "needs_answer" };
    const hash = await hashAnswer(questionAnswer);
    if (hash !== meta.answerHash) {
      if (attemptKey) setAttempts(attemptKey, getAttempts(attemptKey) + 1);
      return { ok: false, error: "wrong_answer" };
    }
  }

  // Expiration check
  if (meta.expiresAt > 0 && Date.now() > meta.expiresAt) {
    return { ok: false, error: "expired" };
  }

  // Clear attempt counter on success
  if (attemptKey) removeAttempts(attemptKey);

  // Decompress
  options?.onProgress?.decompressing();
  let finalData: Buffer;
  if (header.compression !== "none") {
    finalData = await decompressBytes(rawData, header.compression);
  } else {
    finalData = rawData;
  }

  options?.onProgress?.verifying();

  let content: string | null = null;
  let fileData: Buffer | null = null;

  if (header.mode === "file") {
    fileData = finalData;
  } else {
    content = finalData.toString("utf-8");
  }

  return { ok: true, payload: { meta, content, fileData }, header };
}
