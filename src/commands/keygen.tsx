/**
 * Keygen command — generate cryptographically secure keys.
 *
 * Seven modes (parity with the web app): unicode, secure, alpha, hex,
 * base58 (readable, no 0 O I l), pin, uuid (v7).
 * Rejection sampling ensures no modulo bias.
 *
 * Advanced options: --exclude-ambiguous, --exclude, --require-all,
 * --no-repeats, --group. Every key is scored (like /generator on the web)
 * and, with --sort, listed from strongest to weakest.
 */

import React from "react";
import { Box, Text } from "ink";
import {
  generateWithOptions,
  analyzePassword,
  type KeygenMode,
  type GenerateOptions,
  type PasswordAnalysis,
} from "../lib/passwords.js";
import { ICON_ARROW } from "../utils/terminal.js";

export interface KeygenOptions {
  mode: KeygenMode;
  length: number;
  count: number;
  excludeAmbiguous: boolean;
  exclude?: string;
  requireAll: boolean;
  noRepeats: boolean;
  group: number;
  sort: boolean;
  quiet: boolean;
}

const SCORE_LABEL = ["very weak", "weak", "fair", "good", "strong"] as const;
const SCORE_COLOR = ["red", "red", "yellow", "green", "green"] as const;

function ScoreLine({ a }: { a: PasswordAnalysis }) {
  const filled = a.score + 1;
  return (
    <Text>
      <Text color={SCORE_COLOR[a.score]}>{"█".repeat(filled)}{"░".repeat(5 - filled)}</Text>
      <Text color={SCORE_COLOR[a.score]}> {SCORE_LABEL[a.score]}</Text>
      <Text color="gray"> · ~{a.effectiveBits} bits</Text>
    </Text>
  );
}

export function KeygenApp(opts: KeygenOptions) {
  const genOpts: GenerateOptions = {
    excludeAmbiguous: opts.excludeAmbiguous,
    excludeChars: opts.exclude,
    requireAllClasses: opts.requireAll,
    noRepeats: opts.noRepeats,
    groupSize: opts.group,
  };

  let keys = Array.from({ length: opts.count }, () => {
    const value = generateWithOptions(opts.mode, opts.length, genOpts);
    return { value, analysis: analyzePassword(value) };
  });

  if (opts.sort) {
    keys = keys.sort(
      (a, b) =>
        b.analysis.score - a.analysis.score ||
        b.analysis.effectiveBits - a.analysis.effectiveBits
    );
  }

  // --quiet: raw values only (pipe-friendly, like the original behaviour)
  if (opts.quiet) {
    return (
      <Box flexDirection="column">
        {keys.map((k, i) => (
          <Text key={i}>{k.value}</Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{ICON_ARROW} zefer keygen</Text>
        <Text color="gray"> — {opts.mode} / {opts.mode === "uuid" ? "uuid v7" : `${opts.length} chars`}{opts.count > 1 ? ` × ${opts.count}` : ""}</Text>
      </Box>

      {keys.map((k, i) => (
        <Box key={i} flexDirection="column" marginBottom={opts.count > 1 ? 1 : 0}>
          {opts.count > 1 && <Text color="gray">#{i + 1}</Text>}
          <Text color="white">{k.value}</Text>
          <ScoreLine a={k.analysis} />
        </Box>
      ))}
    </Box>
  );
}
