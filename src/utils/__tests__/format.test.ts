/**
 * Formatting helpers — every unit boundary in both directions.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { formatBytes, formatDate, formatTimeRemaining, formatDuration, pluralize } from "../format.js";

const KB = 1024;
const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

afterEach(() => {
  vi.useRealTimers();
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [KB, "1.0 KB"],
    [1536, "1.5 KB"],
    [MB - 1, "1024.0 KB"],
    [MB, "1 MB"],
    [5 * MB, "5 MB"],
    [GB - 1, "1024 MB"],
    [GB, "1.0 GB"],
    [3 * GB + GB / 2, "3.5 GB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("formatDate", () => {
  it('returns "never" for 0', () => {
    expect(formatDate(0)).toBe("never");
  });

  it("renders a real timestamp in the local locale", () => {
    const ts = Date.UTC(2030, 0, 2, 3, 4, 5);
    expect(formatDate(ts)).toBe(new Date(ts).toLocaleString());
  });
});

describe("formatTimeRemaining", () => {
  const NOW = Date.UTC(2030, 0, 1);

  function at(offsetMs: number): string {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return formatTimeRemaining(NOW + offsetMs);
  }

  it('returns "never" for 0', () => {
    expect(formatTimeRemaining(0)).toBe("never");
  });

  it.each([
    [0, "expired"],
    [-60_000, "expired"],
  ])("returns 'expired' for offset %i", (offset, expected) => {
    expect(at(offset)).toBe(expected);
  });

  it("counts seconds under a minute", () => {
    expect(at(45_000)).toBe("45s");
  });

  it("counts minutes and leftover seconds under an hour", () => {
    expect(at(5 * 60_000 + 30_000)).toBe("5m 30s");
  });

  it("counts hours and leftover minutes under a day", () => {
    expect(at(3 * 3_600_000 + 15 * 60_000)).toBe("3h 15m");
  });

  it("counts days and leftover hours beyond a day", () => {
    expect(at(2 * 86_400_000 + 7 * 3_600_000)).toBe("2d 7h");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0ms"],
    [999, "999ms"],
    [1000, "1.0s"],
    [59_999, "60.0s"],
    [60_000, "1m 0s"],
    [125_000, "2m 5s"],
  ])("formats %i ms as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("pluralize", () => {
  it("uses the singular form for exactly one", () => {
    expect(pluralize(1, "chunk")).toBe("1 chunk");
  });

  it("appends an s by default", () => {
    expect(pluralize(0, "chunk")).toBe("0 chunks");
    expect(pluralize(3, "chunk")).toBe("3 chunks");
  });

  it("uses an explicit plural when given", () => {
    expect(pluralize(2, "entry", "entries")).toBe("2 entries");
    expect(pluralize(1, "entry", "entries")).toBe("1 entry");
  });
});
