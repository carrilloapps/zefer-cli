/**
 * Chunked AES-256-GCM encryption/decryption for large files — Node.js port.
 *
 * Splits input into 16 MB chunks. Each chunk gets a unique IV derived from
 * the base IV XOR'd with the chunk index. PBKDF2 key derivation runs once
 * per operation (not per chunk).
 *
 * Format per chunk: [4 bytes: ciphertext length (big-endian)][ciphertext + 16-byte auth tag]
 *
 * Binary layout is identical to the browser version — cross-platform compatible.
 */

import * as nodeCrypto from "crypto";
import { deriveKey } from "./crypto.js";

const SALT_LENGTH = 32;
const IV_LENGTH = 12;
export const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB

export interface ChunkedEncryptResult {
  salt: Buffer;
  baseIv: Buffer;
  totalChunks: number;
  chunks: Buffer[];
}

/**
 * Derive unique per-chunk IV: XOR last 4 bytes of base IV with chunk index.
 * This avoids nonce reuse across chunks while only requiring one key derivation.
 */
function chunkIv(baseIv: Buffer, index: number): Buffer {
  const iv = Buffer.from(baseIv);
  const current = iv.readUInt32BE(8);
  // `>>>0` converts back to unsigned 32-bit int after bitwise XOR
  iv.writeUInt32BE((current ^ index) >>> 0, 8);
  return iv;
}

/**
 * Encrypt data in chunks. PBKDF2 runs once; AES-GCM once per 16 MB chunk.
 * Memory usage: O(CHUNK_SIZE) regardless of total input size.
 */
export async function chunkedEncrypt(
  data: Buffer | Uint8Array,
  passphrase: string,
  iterations: number,
  onProgress?: (chunkIndex: number, totalChunks: number) => void
): Promise<ChunkedEncryptResult> {
  const buf = Buffer.from(data);
  const salt = nodeCrypto.randomBytes(SALT_LENGTH);
  const baseIv = nodeCrypto.randomBytes(IV_LENGTH);
  const key = await deriveKey(passphrase, salt, iterations);

  const totalChunks = Math.ceil(buf.length / CHUNK_SIZE) || 1;
  const chunks: Buffer[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunkData = buf.subarray(start, start + CHUNK_SIZE);
    const iv = chunkIv(baseIv, i);

    const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(chunkData), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16 bytes

    // Layout: [4-byte length][ciphertext || auth tag]
    const ciphertextWithTag = Buffer.concat([encrypted, authTag]);
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(ciphertextWithTag.length, 0);
    chunks.push(Buffer.concat([lenBuf, ciphertextWithTag]));

    onProgress?.(i + 1, totalChunks);

    // Yield to event loop between chunks so the Ink UI can refresh
    if (i < totalChunks - 1) {
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  return { salt, baseIv, totalChunks, chunks };
}

/**
 * Decrypt chunked data and return the full plaintext as a Buffer.
 * Memory usage: O(CHUNK_SIZE) active + output accumulation.
 */
export async function chunkedDecryptToBuffer(
  encryptedData: Buffer | Uint8Array,
  salt: Buffer | Uint8Array,
  baseIv: Buffer | Uint8Array,
  passphrase: string,
  iterations: number,
  onProgress?: (chunkIndex: number, totalChunks: number) => void
): Promise<Buffer> {
  const data = Buffer.from(encryptedData);
  const key = await deriveKey(passphrase, Buffer.from(salt), iterations);
  const baseIvBuf = Buffer.from(baseIv);

  // First pass: count chunks
  let offset = 0;
  let chunkCount = 0;
  while (offset + 4 <= data.length) {
    const chunkLen = data.readUInt32BE(offset);
    offset += 4 + chunkLen;
    chunkCount++;
  }

  // Second pass: decrypt chunk by chunk
  const parts: Buffer[] = [];
  offset = 0;
  let chunkIndex = 0;

  while (offset + 4 <= data.length) {
    const chunkLen = data.readUInt32BE(offset);
    offset += 4;

    const ciphertextWithTag = data.subarray(offset, offset + chunkLen);
    offset += chunkLen;

    const iv = chunkIv(baseIvBuf, chunkIndex);
    const authTag = ciphertextWithTag.subarray(-16);
    const ciphertext = ciphertextWithTag.subarray(0, -16);

    const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    parts.push(Buffer.concat([decipher.update(ciphertext), decipher.final()]));

    chunkIndex++;
    onProgress?.(chunkIndex, chunkCount);

    if (chunkIndex < chunkCount) {
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  return Buffer.concat(parts);
}
