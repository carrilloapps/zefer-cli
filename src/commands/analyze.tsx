/**
 * Analyze command — full security report for any password.
 *
 * Mirrors the web /generator analyzer: effective entropy, attack scenarios
 * (10^2–10^15 guesses/s), framework compliance (NIST SP 800-63B, OWASP,
 * long-term, AES-128, post-quantum Grover), keyspace and comparison vs an
 * average human password (~40 bits). 100% local — nothing leaves the machine.
 */

import React from "react";
import { Box, Text } from "ink";
import {
  analyzePassword,
  crackBucketFor,
  toSuperscript,
  complianceOf,
  keyspaceExponent,
  ATTACK_SCENARIOS,
  AVERAGE_HUMAN_BITS,
  type PasswordWarning,
} from "../lib/passwords.js";
import { ICON_ARROW, ICON_OK, ICON_ERR } from "../utils/terminal.js";

const WARNING_TEXT: Record<PasswordWarning, string> = {
  tooShort: "Too short — use at least 8 characters (ideally 16+)",
  common: "Appears in leaked password lists — cracked instantly",
  onlyDigits: "Digits only — the alphabet is minimal",
  onlyLetters: "Single-case letters only — add uppercase, digits and symbols",
  repeats: "Repeated characters or blocks reduce real entropy",
  sequence: "Contains easy-to-predict sequences (abc, 123…)",
  keyboard: "Contains keyboard patterns (qwerty…)",
  datelike: "Contains a year — attackers try dates first",
  lowVariety: "Low character variety for its length",
};

const SCENARIO_TEXT: Record<string, string> = {
  online: "Throttled login   (10²/s)",
  cloud: "Cloud vs PBKDF2   (10⁶/s)",
  gpu: "GPU farm          (10¹²/s)",
  nation: "Nation-state      (10¹⁵/s)",
};

const FRAME_TEXT: Record<string, string> = {
  nist: "NIST SP 800-63B — minimum length (≥8)",
  owasp: "OWASP baseline (≥64 bits)",
  longterm: "Long-term protection (≥100 bits)",
  aes128: "AES-128 equivalent (≥128 bits)",
  quantum: "Post-quantum — Grover (≥128 bits after halving)",
};

const SCORE_LABEL = ["very weak", "weak", "fair", "good", "strong"] as const;
const SCORE_COLOR = ["red", "red", "yellow", "green", "green"] as const;

function formatCrack(bits: number, gps: number): string {
  const { bucket, value } = crackBucketFor(bits, gps);
  if (bucket === "instant") return "instant";
  if (bucket === "yearsExp") return `≈10${toSuperscript(value)} years`;
  return `${value.toLocaleString()} ${bucket}`;
}

export function AnalyzeApp({ password }: { password: string }) {
  const a = analyzePassword(password);
  const checks = complianceOf(a.effectiveBits, a.length);
  const ksExp = keyspaceExponent(a.effectiveBits);
  const quantumBits = Math.floor(a.effectiveBits / 2);
  const advantageExp = Math.floor((a.effectiveBits - AVERAGE_HUMAN_BITS) * Math.log10(2));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{ICON_ARROW} zefer analyze</Text>
        <Text color="gray"> — {a.length} chars</Text>
      </Box>

      {/* Score */}
      <Box marginBottom={1}>
        <Text color={SCORE_COLOR[a.score]}>
          {"█".repeat(a.score + 1)}{"░".repeat(4 - a.score)} {SCORE_LABEL[a.score]}
        </Text>
      </Box>

      {/* Metrics */}
      <Text color="gray">{"Length".padEnd(22)}<Text color="white">{a.length} chars</Text></Text>
      <Text color="gray">{"Estimated alphabet".padEnd(22)}<Text color="white">{a.poolSize} symbols</Text></Text>
      <Text color="gray">{"Maximum entropy".padEnd(22)}<Text color="white">{a.entropyBits} bits</Text></Text>
      <Text color="gray">{"Effective entropy".padEnd(22)}<Text color="white">{a.effectiveBits} bits</Text></Text>
      <Text color="gray">{"Total keyspace".padEnd(22)}<Text color="white">≈10{toSuperscript(ksExp)}</Text></Text>
      <Text color="gray">{"Post-quantum entropy".padEnd(22)}<Text color="white">{quantumBits} bits</Text></Text>

      {/* Scenarios */}
      <Box marginTop={1}><Text bold>Crack time by attack scenario</Text></Box>
      {ATTACK_SCENARIOS.map((s) => (
        <Text key={s.key} color="gray">
          {"  " + SCENARIO_TEXT[s.key].padEnd(28)}
          <Text color="green">{formatCrack(a.effectiveBits, s.gps)}</Text>
        </Text>
      ))}

      {/* Framework */}
      <Box marginTop={1}><Text bold>Cybersecurity framework</Text></Box>
      {checks.map((c) => (
        <Text key={c.key}>
          {"  "}
          {c.pass ? <Text color="green">{ICON_OK}</Text> : <Text color="yellow">{ICON_ERR}</Text>}
          <Text color="gray"> {FRAME_TEXT[c.key]}</Text>
        </Text>
      ))}

      {/* Average comparison */}
      <Box marginTop={1}>
        <Text color="gray">
          vs average human (~{AVERAGE_HUMAN_BITS} bits):{" "}
          {advantageExp > 0 ? (
            <Text color="green">≈10{toSuperscript(advantageExp)}× more combinations</Text>
          ) : (
            <Text color="yellow">below the human average</Text>
          )}
        </Text>
      </Box>

      {/* Warnings */}
      {a.warnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">Detected weaknesses</Text>
          {a.warnings.map((w) => (
            <Text key={w} color="yellow">  • {WARNING_TEXT[w]}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
