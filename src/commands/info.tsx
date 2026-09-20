/**
 * Info command — show public header of a .zefer file without decrypting.
 *
 * Displays: format, mode, iterations, compression, hint, note, security features.
 */

import React from "react";
import { Box, Text } from "ink";
import * as fs from "node:fs";
import * as path from "node:path";
import * as nodeCrypto from "node:crypto";
import { parseFile, type ZeferHeader } from "../lib/zefer.js";
import { crackBucketFor, toSuperscript } from "../lib/passwords.js";
import { formatBytes } from "../utils/format.js";
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

/** Shannon entropy in bits/byte (proper AES output ≈ 8.0). Callers only pass
 *  samples of at least 1 KB, so an empty buffer never reaches here. */
function shannonEntropy(bytes: Buffer): number {
  const freq = new Array<number>(256).fill(0);
  for (const byte of bytes) freq[byte]++;
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

/** Human label for the on-disk container, derived from the leading magic bytes. */
function detectFormat(rawBytes: Buffer): string {
  const magic = rawBytes.subarray(0, 6).toString("ascii");
  if (magic.startsWith("ZEFB3")) return "ZEFB3 (binary, single key)";
  if (magic.startsWith("ZEFR3")) return "ZEFR3 (binary, with reveal key)";
  if (magic === "ZEFER3") return "ZEFER3 (legacy text)";
  if (magic === "ZEFER2") return "ZEFER2 (legacy text)";
  return "unknown";
}

/** Colour scale for the PBKDF2 iteration count: 1M/600k green, 300k amber, below red. */
function iterationsColor(iterations: number): string {
  if (iterations >= 600_000) return "green";
  if (iterations >= 300_000) return "yellow";
  return "red";
}

/** The security traits that are visible without the passphrase. */
function publicFeatures(rawBytes: Buffer, header: ZeferHeader): string[] {
  const features: string[] = [];
  if (rawBytes.subarray(0, 5).toString("ascii") === "ZEFR3") features.push("reveal key");
  if (header.hint) features.push("hint");
  if (header.note) features.push("public note");
  return features;
}

function Row({ label, value, color = "white" }: Readonly<Field>) {
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

export function InfoApp({ input }: Readonly<InfoAppProps>) {
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
  const format = detectFormat(rawBytes);
  const securityFeatures = publicFeatures(rawBytes, header);

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
          color={iterationsColor(header.iterations)}
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

type ParsedZefer = NonNullable<ReturnType<typeof parseFile>>;

interface Structure {
  /** `null` when there is no binary block to walk (legacy text formats). */
  ok: boolean | null;
  chunks: number;
  estimatedPlain: number;
  /** Shannon entropy of a 64 KB ciphertext sample, `null` when the sample is too small. */
  entropy: number | null;
}

/** Walk both blocks of the file and measure how random the ciphertext looks. */
function analyzeStructure(parsed: ParsedZefer): Structure {
  const main = parsed.binaryData ? walkChunks(parsed.binaryData) : null;
  const reveal = parsed.revealBinaryData ? walkChunks(parsed.revealBinaryData) : null;

  const sample = parsed.binaryData?.subarray(
    44,
    Math.min(parsed.binaryData.length, 44 + 64 * 1024)
  );

  return {
    ok: main ? main.ok && (reveal === null || reveal.ok) : null,
    chunks: (main?.chunks ?? 0) + (reveal?.chunks ?? 0),
    estimatedPlain: main ? Math.max(0, main.ciphertext - 16 * main.chunks) : 0,
    entropy: sample && sample.length >= 1024 ? shannonEntropy(sample) : null,
  };
}

interface Observation {
  text: string;
  color: string;
}

/** Severity-tagged findings, mirroring the web `/analyzer` report. */
function buildObservations(parsed: ParsedZefer, header: ZeferHeader, structure: Structure): Observation[] {
  const { ok, entropy } = structure;
  const candidates: [boolean, Observation][] = [
    [ok === false, { text: "Internal structure does not match the declared format", color: "red" }],
    [
      entropy !== null && entropy < 7.5,
      { text: "Ciphertext randomness is unusually low — corrupted or not real ciphertext", color: "red" },
    ],
    [
      header.iterations < 600_000,
      { text: "KDF at standard level — consider 600k or 1M iterations for sensitive data", color: "yellow" },
    ],
    [
      !!header.hint,
      { text: "Public hint visible without the passphrase — make sure it does not reveal too much", color: "yellow" },
    ],
    [!!header.note, { text: "Public note visible to anyone holding the file", color: "gray" }],
    [
      !!parsed.revealBinaryData,
      { text: "Reveal key included: two valid passphrases can decrypt — wider access surface", color: "gray" },
    ],
    [
      !!header.compression && header.compression !== "none",
      { text: "Compression enabled: ciphertext size may hint at content compressibility", color: "gray" },
    ],
  ];
  return candidates.filter(([applies]) => applies).map(([, observation]) => observation);
}

function DeepAnalysis({
  rawBytes,
  parsed,
  header,
}: Readonly<{
  rawBytes: Buffer;
  parsed: ParsedZefer;
  header: ZeferHeader;
}>) {
  const sha256 = nodeCrypto.createHash("sha256").update(rawBytes).digest("hex");

  const structure = analyzeStructure(parsed);
  const { ok: structureOk, chunks, estimatedPlain, entropy } = structure;

  const guessesPerGpu = Math.max(1, Math.round(1e10 / (2 * header.iterations)));
  const fleet = guessesPerGpu * 1000;

  const obs = buildObservations(parsed, header, structure);
  const compressionNote = header.compression !== "none" ? " (before decompression)" : "";

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
          <Row label="Est. content" value={`~${formatBytes(estimatedPlain)}${compressionNote}`} />
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
