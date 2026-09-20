/**
 * `zefer keygen` — the Ink view over the generator.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { KeygenApp, type KeygenOptions } from "../keygen.js";
import { ICON_ARROW } from "../../utils/terminal.js";

function options(overrides: Partial<KeygenOptions> = {}): KeygenOptions {
  return {
    mode: "hex",
    length: 16,
    count: 1,
    excludeAmbiguous: false,
    requireAll: false,
    noRepeats: false,
    group: 0,
    sort: false,
    quiet: false,
    ...overrides,
  };
}

/** Render once and return the frame plus a cleanup-free string. */
function frameOf(opts: KeygenOptions): string {
  const { lastFrame, unmount } = render(<KeygenApp {...opts} />);
  const frame = lastFrame()!;
  unmount();
  return frame;
}

describe("KeygenApp — quiet mode", () => {
  it("prints one raw key per line and nothing else", () => {
    const frame = frameOf(options({ quiet: true, count: 3 }));
    const lines = frame.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{16}$/);
    expect(frame).not.toContain("zefer keygen");
  });
});

describe("KeygenApp — report mode", () => {
  it("shows the header, the key and its strength meter", () => {
    const frame = frameOf(options({ mode: "secure", length: 32 }));
    expect(frame).toContain(`${ICON_ARROW} zefer keygen`);
    expect(frame).toContain("secure / 32 chars");
    expect(frame).toContain("strong");
    expect(frame).toMatch(/~\d+ bits/);
    expect(frame).not.toContain("#1"); // no numbering for a single key
    expect(frame).not.toContain("×");
  });

  it("numbers the keys and shows the count when more than one is asked for", () => {
    const frame = frameOf(options({ count: 3 }));
    expect(frame).toContain("× 3");
    expect(frame).toContain("#1");
    expect(frame).toContain("#3");
  });

  it("labels uuid mode as uuid v7 instead of a character count", () => {
    const frame = frameOf(options({ mode: "uuid", length: 64 }));
    expect(frame).toContain("uuid / uuid v7");
    expect(frame).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it("shows a weak meter for a short PIN", () => {
    const frame = frameOf(options({ mode: "pin", length: 4 }));
    expect(frame).toMatch(/very weak|weak/);
  });

  it("passes the advanced options through to the generator", () => {
    const frame = frameOf(
      options({ mode: "alpha", length: 12, excludeAmbiguous: true, group: 4 })
    );
    const key = frame.split("\n").find((l) => /^[A-Za-z0-9-]{14}$/.test(l.trim()))!;
    expect(key.trim()).toMatch(/^[^-]{4}-[^-]{4}-[^-]{4}$/);
    expect(key).not.toMatch(/[0O1lI]/);
  });

  it("sorts keys from strongest to weakest when asked", () => {
    // A 4-digit PIN scores at the bottom of the scale, a 40-char secure key at
    // the top: mixing lengths is not possible, so assert the ordering invariant
    // on the printed bit counts instead.
    const frame = frameOf(options({ mode: "secure", length: 20, count: 8, sort: true }));
    const bits = [...frame.matchAll(/~(\d+) bits/g)].map((m) => Number(m[1]));
    expect(bits).toHaveLength(8);
    expect(bits).toEqual([...bits].sort((a, b) => b - a));
  });

  it("keeps generation order when sorting is off", () => {
    const frame = frameOf(options({ count: 4 }));
    const indices = [...frame.matchAll(/#(\d)/g)].map((m) => Number(m[1]));
    expect(indices).toEqual([1, 2, 3, 4]);
  });
});
