/**
 * Info command — show public header of a .zefer file without decrypting.
 *
 * Displays: format, mode, iterations, compression, hint, note, security features.
 */

import React from "react";
import { Box, Text } from "ink";
import * as fs from "fs";
import * as path from "path";
import { parseFile, type ZeferHeader } from "../lib/zefer.js";
import { formatBytes, formatDate, formatTimeRemaining } from "../utils/format.js";
import { ICON_ARROW, ICON_SEP, ICON_ERR } from "../utils/terminal.js";

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

      <Box marginTop={1}>
        <Text color="gray" italic>
          Secret question, IP restriction, expiration, and max attempts
          are inside the encrypted payload and cannot be read without the passphrase.
        </Text>
      </Box>
    </Box>
  );
}
