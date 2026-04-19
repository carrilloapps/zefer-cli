import React, { useState, useEffect } from "react";
import { Text } from "ink";
import { SPINNER_FRAMES } from "../utils/terminal.js";

interface SpinnerProps {
  color?: string;
}

export function Spinner({ color = "cyan" }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      80
    );
    return () => clearInterval(id);
  }, []);

  return <Text color={color}>{SPINNER_FRAMES[frame]}</Text>;
}
