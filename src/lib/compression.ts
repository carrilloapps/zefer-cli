/**
 * Compression/decompression — Node.js port using zlib.
 *
 * Replaces the browser's CompressionStream/DecompressionStream API.
 * Output is byte-for-byte identical to the browser version.
 */

import * as zlib from "zlib";
import { promisify } from "util";

export type CompressionMethod = "none" | "gzip" | "deflate" | "deflate-raw";

const MAX_DECOMPRESS_SIZE = 512 * 1024 * 1024; // 512 MB safety limit

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);
const deflateRaw = promisify(zlib.deflateRaw);
const inflateRaw = promisify(zlib.inflateRaw);

export async function compressBytes(
  data: Buffer | Uint8Array,
  method: CompressionMethod
): Promise<Buffer> {
  const buf = Buffer.from(data);
  switch (method) {
    case "none":
      return buf;
    case "gzip":
      return gzip(buf);
    case "deflate":
      return deflate(buf);
    case "deflate-raw":
      return deflateRaw(buf);
  }
}

export async function decompressBytes(
  data: Buffer | Uint8Array,
  method: CompressionMethod
): Promise<Buffer> {
  const buf = Buffer.from(data);
  let result: Buffer;
  switch (method) {
    case "none":
      return buf;
    case "gzip":
      result = await gunzip(buf);
      break;
    case "deflate":
      result = await inflate(buf);
      break;
    case "deflate-raw":
      result = await inflateRaw(buf);
      break;
    default:
      return buf;
  }
  if (result.length > MAX_DECOMPRESS_SIZE) {
    throw new Error(
      `Decompressed output exceeds maximum allowed size (${MAX_DECOMPRESS_SIZE / 1024 / 1024} MB)`
    );
  }
  return result;
}

/**
 * Try compression. Only use the compressed version if it is smaller.
 * Returns original data if compression is disabled or makes it larger.
 */
export async function smartCompress(
  data: Buffer | Uint8Array,
  method: CompressionMethod
): Promise<{ data: Buffer; wasCompressed: boolean }> {
  if (method === "none") return { data: Buffer.from(data), wasCompressed: false };
  try {
    const compressed = await compressBytes(data, method);
    if (compressed.length < data.length) {
      return { data: compressed, wasCompressed: true };
    }
    return { data: Buffer.from(data), wasCompressed: false };
  } catch {
    return { data: Buffer.from(data), wasCompressed: false };
  }
}
