import React from "react";
import { Box, Text } from "ink";
import { ICON_ARROW, ICON_SEP } from "../utils/terminal.js";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        {ICON_ARROW} {title}
      </Text>
      {subtitle && <Text color="gray">  {subtitle}</Text>}
      <Text color="gray">{ICON_SEP.repeat(48)}</Text>
    </Box>
  );
}
