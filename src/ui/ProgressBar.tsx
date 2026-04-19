import React from "react";
import { Box, Text } from "ink";
import { BAR_FILLED, BAR_EMPTY } from "../utils/terminal.js";

interface ProgressBarProps {
  percent: number; // 0–100
  width?: number;
  showLabel?: boolean;
}

export function ProgressBar({ percent, width = 32, showLabel = true }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;

  return (
    <Box>
      <Text color="cyan">{BAR_FILLED.repeat(filled)}</Text>
      <Text color="gray">{BAR_EMPTY.repeat(empty)}</Text>
      {showLabel && (
        <Text color="white"> {String(clamped).padStart(3, " ")}%</Text>
      )}
    </Box>
  );
}
