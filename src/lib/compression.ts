/**
 * Compression/decompression — Node.js port using zlib.
 *
 * Replaces the browser's CompressionStream/DecompressionStream API.
 * Output is byte-for-byte identical to the browser version.
 */

import * as zlib from "zlib";
import { promisify } from "util";

export type CompressionMethod = "none" | "gzip" | "deflate" | "deflate-raw";

/**
 * Default decompression-bomb safety cap (512 MB).
 *
 * This default applies to the **library** channel only — `decodeZefer` keeps it
 * unless an explicit `maxDecompressSize` is provided. The CLI and MCP channels
 * pass `0` (unlimited) so a real, locally-trusted file is never rejected for
 * being large; progress is reported instead. Pass `0` or a non-finite value to
 * `decompressBytes` to disable the cap.
 */
export const MAX_DECOMPRESS_SIZE = 512 * 1024 * 1024; // 512 MB

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

/**
 * @param maxSize Decompression-bomb cap in bytes. Defaults to
 *   {@link MAX_DECOMPRESS_SIZE} (the library default). Pass `0` or a non-finite
 *   value to disable the cap entirely (CLI / MCP channels).
 */
export async function decompressBytes(
  data: Buffer | Uint8Array,
  method: CompressionMethod,
  maxSize: number = MAX_DECOMPRESS_SIZE
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
  const capped = Number.isFinite(maxSize) && maxSize > 0;
  if (capped && result.length > maxSize) {
    throw new Error(
      `Decompressed output exceeds maximum allowed size (${maxSize / 1024 / 1024} MB)`
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
