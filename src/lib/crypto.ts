/**
 * AES-256-GCM + PBKDF2-SHA256 crypto primitives — Node.js port.
 *
 * Binary format is identical to the browser Web Crypto version (ZEFB3/ZEFR3),
 * so files encrypted by the CLI are decryptable in the browser and vice-versa.
 *
 * AES-GCM ciphertext layout: [encrypted bytes][16-byte GCM auth tag]
 * This matches the Web Crypto API output exactly.
 */

import * as nodeCrypto from "crypto";
import { promisify } from "util";

const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const KEY_LENGTH = 32; // 256 bits

const pbkdf2Async = promisify(nodeCrypto.pbkdf2);

// ─── Encoding helpers ───

export function toBase64(data: Buffer | Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

export function fromBase64(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

export function encodeText(text: string): Buffer {
  return Buffer.from(text, "utf-8");
}

export function decodeBytes(data: Buffer | Uint8Array): string {
  return Buffer.from(data).toString("utf-8");
}

// ─── Key derivation (runs in libuv thread pool — non-blocking) ───

export async function deriveKey(
  passphrase: string,
  salt: Buffer,
  iterations: number
): Promise<Buffer> {
  return pbkdf2Async(
    Buffer.from(passphrase, "utf-8"),
    salt,
    iterations,
    KEY_LENGTH,
    "sha256"
  );
}

// ─── Public API ───

export function combineDualKeys(primary: string, secondary: string): string {
  return `${primary}\x00ZEFER_DUAL\x00${secondary}`;
}

export async function encrypt(
  plaintext: string,
  passphrase: string,
  iterations = 600_000
): Promise<string> {
  return encryptBytesToBase64(Buffer.from(plaintext, "utf-8"), passphrase, iterations);
}

export async function encryptBytesToBase64(
  data: Buffer | Uint8Array,
  passphrase: string,
  iterations = 600_000
): Promise<string> {
  const { salt, iv, ciphertext } = await encryptRaw(data, passphrase, iterations);
  return [toBase64(salt), toBase64(iv), toBase64(ciphertext)].join(".");
}

export async function encryptRaw(
  data: Buffer | Uint8Array,
  passphrase: string,
  iterations = 600_000
): Promise<{ salt: Buffer; iv: Buffer; ciphertext: Buffer }> {
  const salt = nodeCrypto.randomBytes(SALT_LENGTH);
  const iv = nodeCrypto.randomBytes(IV_LENGTH);
  const key = await deriveKey(passphrase, salt, iterations);

  const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
  const authTag = cipher.getAuthTag(); // always 16 bytes

  // Match Web Crypto layout: encrypted_bytes || auth_tag
  return { salt, iv, ciphertext: Buffer.concat([encrypted, authTag]) };
}

export async function decrypt(
  encrypted: string,
  passphrase: string,
  iterations = 600_000
): Promise<string> {
  const buf = await decryptFromBase64(encrypted, passphrase, iterations);
  return buf.toString("utf-8");
}

export async function decryptFromBase64(
  encrypted: string,
  passphrase: string,
  iterations = 600_000
): Promise<Buffer> {
  const [saltB64, ivB64, ciphertextB64] = encrypted.split(".");
  const salt = fromBase64(saltB64);
  const iv = fromBase64(ivB64);
  const ciphertextWithTag = fromBase64(ciphertextB64);
  const key = await deriveKey(passphrase, salt, iterations);

  const authTag = ciphertextWithTag.subarray(-16);
  const ciphertext = ciphertextWithTag.subarray(0, -16);

  const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export async function decryptFromBinary(
  binary: Buffer | Uint8Array,
  passphrase: string,
  iterations = 600_000
): Promise<Buffer> {
  const buf = Buffer.from(binary);
  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertextWithTag = buf.subarray(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt, iterations);

  const authTag = ciphertextWithTag.subarray(-16);
  const ciphertext = ciphertextWithTag.subarray(0, -16);

  const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Hash a secret question answer with PBKDF2 using a deterministic salt.
 * Normalizes by trimming and lowercasing before hashing.
 */
export async function hashAnswer(answer: string): Promise<string> {
  const normalized = answer.trim().toLowerCase();
  const saltSource = nodeCrypto
    .createHash("sha256")
    .update(`ZEFER_ANSWER_SALT:${normalized}`)
    .digest();
  const salt = saltSource.subarray(0, 16);
  const hash = await pbkdf2Async(
    Buffer.from(normalized, "utf-8"),
    salt,
    100_000,
    32,
    "sha256"
  );
  return toBase64(hash);
}

/**
 * Run a quick PBKDF2 benchmark to estimate how many iterations this machine
 * can do comfortably. Returns estimated ms per 100k iterations.
 */
export async function benchmarkDevice(): Promise<number> {
  const testSalt = nodeCrypto.randomBytes(32);
  const start = Date.now();
  await pbkdf2Async(Buffer.from("benchmark", "utf-8"), testSalt, 50_000, 32, "sha256");
  const elapsed = Date.now() - start;
  return (elapsed / 50_000) * 100_000;
}
