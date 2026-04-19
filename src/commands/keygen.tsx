/**
 * Keygen command — generate cryptographically secure keys.
 *
 * Five modes: alpha, hex, uuid, secure, unicode
 * Rejection sampling ensures no modulo bias.
 */

import React from "react";
import { Box, Text } from "ink";
import { generateKey, type KeygenMode } from "../lib/keygen.js";
import { ICON_ARROW } from "../utils/terminal.js";

export interface KeygenOptions {
  mode: KeygenMode;
  length: number;
  count: number;
}

export function KeygenApp({ mode, length, count }: KeygenOptions) {
  const keys = Array.from({ length: count }, () => generateKey(mode, length));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{ICON_ARROW} zefer keygen</Text>
        <Text color="gray"> — {mode} / {length} chars</Text>
      </Box>

      {keys.map((key, i) => (
        <Box key={i} flexDirection="column" marginBottom={count > 1 ? 1 : 0}>
          {count > 1 && <Text color="gray">#{i + 1}</Text>}
          <Text color="white">{key}</Text>
        </Box>
      ))}
    </Box>
  );
}
