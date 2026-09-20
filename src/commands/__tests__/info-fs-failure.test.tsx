/**
 * `zefer info` when the filesystem layer throws something that is not an
 * `Error` — the report must still show a readable message, never
 * "[object Object]" or "undefined". Needs its own file because `node:fs` is
 * mocked for the whole module graph.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import { render } from "ink-testing-library";
import { ICON_ERR } from "../../utils/terminal.js";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof fs>("node:fs");
  return {
    ...actual,
    readFileSync: () => {
      throw "EPERM from a patched filesystem"; // a bare string, not an Error
    },
  };
});

const { InfoApp } = await import("../info.js");

describe("InfoApp — non-Error filesystem failure", () => {
  it("stringifies the thrown value into the error line", () => {
    const { lastFrame, unmount } = render(<InfoApp input="whatever.zefer" />);
    expect(lastFrame()).toBe(`${ICON_ERR} Cannot read file: EPERM from a patched filesystem`);
    unmount();
  });
});
