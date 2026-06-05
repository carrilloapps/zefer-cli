/**
 * Info command — show public header of a .zefer file without decrypting.
 *
 * Displays: format, mode, iterations, compression, hint, note, security features.
 */

import React from "react";
import { Box, Text } from "ink";
import * as fs from "fs";
import * as path from "path";
import * as nodeCrypto from "crypto";
import { parseFile, type ZeferHeader } from "../lib/zefer.js";
import { crackBucketFor, toSuperscript } from "../lib/passwords.js";
import { formatBytes, formatDate, formatTimeRemaining } from "../utils/format.js";
import { ICON_ARROW, ICON_SEP, ICON_ERR, ICON_OK } from "../utils/terminal.js";

// ─── Deep analysis (parity with the web /analyzer, no passphrase needed) ───

/** Walk the 4-byte-length chunk framing after salt(32) + iv(12) */
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

/** Shannon entropy in bits/byte (proper AES output ≈ 8.0) */
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

// KDF brute-force model: PBKDF2-SHA256 ≈ 2 SHA-256 ops/iteration;
// high-end GPU ≈ 10^10 SHA-256/s; fleet model of 1,000 GPUs.
const KDF_ROWS: { label: string; bits: number }[] = [
  { label: "6 common chars (~28 bits)", bits: 28 },
  { label: "8 mixed chars (~45 bits)", bits: 45 },
  { label: "12 mixed chars (~72 bits)", bits: 72 },
  { label: "64-char generated (~400 bits)", bits: 400 },
];

function formatCrack(bits: number, gps: number): string {
  const { bucket, value } = crackBucketFor(bits, gps);
  if (bucket === "instant") return "instant";
  if (bucket === "yearsExp") return `≈10${toSuperscript(value)} years`;
  return `${value.toLocaleString()} ${bucket}`;
}

interface Field {
  label: string;
  value: string;
  color?: string;
}

function Row({ label, value, color = "white" }: Field) {
  return (
    <Box>
      <Text color="gray">{label.padEnd(16)}</Text>
      <Text color={color}>{value}</Text>
    </Box>
  );
}

interface InfoAppProps {
  input: string;
}

export function InfoApp({ input }: InfoAppProps) {
  let rawBytes: Buffer;
  let fileSize: number;

  try {
    rawBytes = fs.readFileSync(input);
    fileSize = rawBytes.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return <Text color="red">{ICON_ERR} Cannot read file: {msg}</Text>;
  }

  const fileContent = rawBytes.toString("utf-8", 0, Math.min(rawBytes.length, 2048));
  const parsed = parseFile(fileContent, rawBytes);

  if (!parsed) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">{ICON_ERR} Not a valid .zefer file</Text>
        <Text color="gray">  File: {path.basename(input)} ({formatBytes(fileSize)})</Text>
      </Box>
    );
  }

  const { header } = parsed;

  // Detect format
  const magic = rawBytes.subarray(0, 5).toString("ascii");
  const format =
    magic === "ZEFB3"
      ? "ZEFB3 (binary, single key)"
      : magic === "ZEFR3"
      ? "ZEFR3 (binary, with reveal key)"
      : magic.startsWith("ZEFER")
      ? "ZEFER3 (legacy text)"
      : magic.startsWith("ZEFER")
      ? "ZEFER2 (legacy text)"
      : "unknown";

  // Security features
  const securityFeatures: string[] = [];
  // We can only tell from the header if there's a reveal key (ZEFR3)
  if (magic === "ZEFR3") securityFeatures.push("reveal key");
  if (header.hint) securityFeatures.push("hint");
  if (header.note) securityFeatures.push("public note");

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          {ICON_ARROW} zefer info
        </Text>
        <Text color="gray">  {path.basename(input)}</Text>
        <Text color="gray">{ICON_SEP.repeat(48)}</Text>
      </Box>

      <Box flexDirection="column">
        <Row label="File" value={`${path.basename(input)} (${formatBytes(fileSize)})`} />
        <Row label="Format" value={format} color="cyan" />
        <Row label="Mode" value={header.mode} />
        <Row
          label="Iterations"
          value={header.iterations.toLocaleString()}
          color={header.iterations >= 600_000 ? "green" : header.iterations >= 300_000 ? "yellow" : "red"}
        />
        <Row label="Compression" value={header.compression} />

        {header.hint && (
          <Row label="Hint" value={header.hint} color="yellow" />
        )}
        {header.note && (
          <Row label="Note" value={header.note} color="cyan" />
        )}

        {securityFeatures.length > 0 && (
          <Row label="Features" value={securityFeatures.join(", ")} color="green" />
        )}
      </Box>

      <DeepAnalysis rawBytes={rawBytes} parsed={parsed} header={header} />

      <Box marginTop={1}>
        <Text color="gray" italic>
          Secret question, IP restriction, expiration, and max attempts
          are inside the encrypted payload and cannot be read without the passphrase.
        </Text>
      </Box>
    </Box>
  );
}

function DeepAnalysis({
  rawBytes,
  parsed,
  header,
}: {
  rawBytes: Buffer;
  parsed: NonNullable<ReturnType<typeof parseFile>>;
  header: ZeferHeader;
}) {
  const sha256 = nodeCrypto.createHash("sha256").update(rawBytes).digest("hex");

  const main = parsed.binaryData ? walkChunks(parsed.binaryData) : null;
  const reveal = parsed.revealBinaryData ? walkChunks(parsed.revealBinaryData) : null;
  const structureOk = main ? main.ok && (reveal === null || reveal.ok) : null;
  const chunks = (main?.chunks ?? 0) + (reveal?.chunks ?? 0);
  const estimatedPlain = main ? Math.max(0, main.ciphertext - 16 * main.chunks) : 0;

  const sample = parsed.binaryData
    ? parsed.binaryData.subarray(44, Math.min(parsed.binaryData.length, 44 + 64 * 1024))
    : null;
  const entropy = sample && sample.length >= 1024 ? shannonEntropy(sample) : null;

  const guessesPerGpu = Math.max(1, Math.round(1e10 / (2 * header.iterations)));
  const fleet = guessesPerGpu * 1000;

  // Security observations (severity-tagged, like the web /analyzer)
  const obs: { text: string; color: string }[] = [];
  if (structureOk === false) obs.push({ text: "Internal structure does not match the declared format", color: "red" });
  if (entropy !== null && entropy < 7.5) obs.push({ text: "Ciphertext randomness is unusually low — corrupted or not real ciphertext", color: "red" });
  if (header.iterations < 600_000) obs.push({ text: "KDF at standard level — consider 600k or 1M iterations for sensitive data", color: "yellow" });
  if (header.hint) obs.push({ text: "Public hint visible without the passphrase — make sure it does not reveal too much", color: "yellow" });
  if (header.note) obs.push({ text: "Public note visible to anyone holding the file", color: "gray" });
  if (parsed.revealBinaryData) obs.push({ text: "Reveal key included: two valid passphrases can decrypt — wider access surface", color: "gray" });
  if (header.compression && header.compression !== "none") obs.push({ text: "Compression enabled: ciphertext size may hint at content compressibility", color: "gray" });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">Deep analysis</Text>

      {structureOk !== null && (
        <Text>
          {"  "}
          {structureOk ? <Text color="green">{ICON_OK} structure valid</Text> : <Text color="red">{ICON_ERR} structure inconsistent — corrupted or truncated</Text>}
          {structureOk && <Text color="gray"> — header, salt, IV and chunk framing consistent</Text>}
        </Text>
      )}
      {parsed.binaryData && (
        <>
          <Row label="Chunks" value={`${chunks}`} />
          <Row label="Est. content" value={`~${formatBytes(estimatedPlain)}${header.compression !== "none" ? " (before decompression)" : ""}`} />
          {entropy !== null && (
            <Row
              label="Randomness"
              value={`${entropy.toFixed(2)} bits/byte`}
              color={entropy >= 7.5 ? "green" : "red"}
            />
          )}
          <Row label="Salt (public)" value={parsed.binaryData.subarray(0, 32).toString("hex")} color="gray" />
          <Row label="Base IV (public)" value={parsed.binaryData.subarray(32, 44).toString("hex")} color="gray" />
        </>
      )}
      <Row label="SHA-256" value={sha256} color="green" />

      <Box marginTop={1} flexDirection="column">
        <Text bold>Passphrase resistance with this KDF</Text>
        <Text color="gray">
          ≈{guessesPerGpu.toLocaleString()} guesses/s per high-end GPU · times for a 1,000-GPU fleet:
        </Text>
        {KDF_ROWS.map((r) => (
          <Text key={r.label} color="gray">
            {"  " + r.label.padEnd(32)}
            <Text color="green">{formatCrack(r.bits, fleet)}</Text>
          </Text>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Security observations</Text>
        {obs.length === 0 ? (
          <Text color="green">  {ICON_OK} none — the file follows best practices</Text>
        ) : (
          obs.map((o) => (
            <Text key={o.text} color={o.color}>  • {o.text}</Text>
          ))
        )}
      </Box>
    </Box>
  );
}
