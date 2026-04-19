import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";
import { ProgressBar } from "./ProgressBar.js";
import { ICON_OK, ICON_ERR } from "../utils/terminal.js";
import type { CryptoStage, ProgressState } from "../lib/progress.js";

interface StatusLineProps {
  progress: ProgressState | null;
  done: boolean;
  error: string | null;
  doneMessage?: string;
}

const STAGE_COLORS: Partial<Record<CryptoStage, string>> = {
  reading: "blue",
  compressing: "blue",
  deriving: "yellow",
  encrypting: "cyan",
  packaging: "cyan",
  decrypting: "cyan",
  decompressing: "blue",
  verifying: "green",
  writing: "green",
  done: "green",
};

export function StatusLine({ progress, done, error, doneMessage }: StatusLineProps) {
  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">{ICON_ERR} {error}</Text>
      </Box>
    );
  }

  if (done) {
    return (
      <Box flexDirection="column">
        <Text color="green">{ICON_OK} {doneMessage ?? "Done"}</Text>
      </Box>
    );
  }

  if (!progress) {
    return (
      <Box>
        <Spinner />
        <Text> Initializing...</Text>
      </Box>
    );
  }

  const color = STAGE_COLORS[progress.stage] ?? "white";

  return (
    <Box flexDirection="column" gap={0}>
      <Box gap={1}>
        <Spinner color={color} />
        <Text color={color}>{progress.label}</Text>
      </Box>
      <ProgressBar percent={progress.percent} />
    </Box>
  );
}
