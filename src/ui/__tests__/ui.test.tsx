/**
 * Ink presentation components. Glyphs are imported from `terminal.ts` so the
 * assertions hold on both the Unicode and the ASCII code path.
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render } from "ink-testing-library";
import { Header } from "../Header.js";
import { ProgressBar } from "../ProgressBar.js";
import { Spinner } from "../Spinner.js";
import { StatusLine } from "../StatusLine.js";
import {
  SPINNER_FRAMES,
  BAR_FILLED,
  BAR_EMPTY,
  ICON_OK,
  ICON_ERR,
  ICON_ARROW,
  ICON_SEP,
} from "../../utils/terminal.js";
import type { ProgressState } from "../../lib/progress.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Header", () => {
  it("renders the title with the arrow glyph and a 48-character rule", () => {
    const { lastFrame, unmount } = render(<Header title="zefer encrypt" />);
    const frame = lastFrame()!;
    expect(frame).toContain(`${ICON_ARROW} zefer encrypt`);
    expect(frame).toContain(ICON_SEP.repeat(48));
    unmount();
  });

  it("renders the subtitle when given and omits the line otherwise", () => {
    const withSub = render(<Header title="zefer decrypt" subtitle="secret.zefer" />);
    expect(withSub.lastFrame()).toContain("secret.zefer");
    withSub.unmount();

    const without = render(<Header title="zefer decrypt" />);
    expect(without.lastFrame()!.split("\n")).toHaveLength(3); // title, rule, blank
    without.unmount();
  });
});

describe("ProgressBar", () => {
  it("fills proportionally and prints a right-aligned percentage", () => {
    const { lastFrame, unmount } = render(<ProgressBar percent={50} width={10} />);
    const frame = lastFrame()!;
    expect(frame).toContain(BAR_FILLED.repeat(5) + BAR_EMPTY.repeat(5));
    expect(frame).toContain(" 50%");
    unmount();
  });

  it("uses a 32-character bar by default", () => {
    const { lastFrame, unmount } = render(<ProgressBar percent={100} />);
    expect(lastFrame()).toContain(BAR_FILLED.repeat(32));
    unmount();
  });

  it("clamps out-of-range percentages to 0 and 100", () => {
    const low = render(<ProgressBar percent={-25} width={8} />);
    expect(low.lastFrame()).toContain(BAR_EMPTY.repeat(8));
    expect(low.lastFrame()).toContain("  0%");
    low.unmount();

    const high = render(<ProgressBar percent={250} width={8} />);
    expect(high.lastFrame()).toContain(BAR_FILLED.repeat(8));
    expect(high.lastFrame()).toContain("100%");
    high.unmount();
  });

  it("hides the label when showLabel is false", () => {
    const { lastFrame, unmount } = render(<ProgressBar percent={40} width={10} showLabel={false} />);
    expect(lastFrame()).not.toContain("%");
    unmount();
  });
});

describe("Spinner", () => {
  it("advances one frame every 80 ms and wraps around", async () => {
    vi.useFakeTimers();
    const { lastFrame, unmount } = render(<Spinner />);
    expect(lastFrame()).toBe(SPINNER_FRAMES[0]);

    await vi.advanceTimersByTimeAsync(80);
    expect(lastFrame()).toBe(SPINNER_FRAMES[1]);

    await vi.advanceTimersByTimeAsync(80 * (SPINNER_FRAMES.length - 1));
    expect(lastFrame()).toBe(SPINNER_FRAMES[0]);
    unmount();
  });

  it("clears its interval on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<Spinner color="green" />);
    await vi.advanceTimersByTimeAsync(0); // let the effect register the interval
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    await vi.advanceTimersByTimeAsync(0); // let the cleanup run
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("StatusLine", () => {
  const progress: ProgressState = { stage: "encrypting", percent: 42, label: "Encrypting" };

  it("shows the error and nothing else when one is set", () => {
    const { lastFrame, unmount } = render(
      <StatusLine progress={progress} done={true} error="Wrong passphrase" />
    );
    expect(lastFrame()).toContain(`${ICON_ERR} Wrong passphrase`);
    expect(lastFrame()).not.toContain("Encrypting");
    unmount();
  });

  it("shows the done message when finished", () => {
    const { lastFrame, unmount } = render(
      <StatusLine progress={null} done={true} error={null} doneMessage="out.zefer (1.0 KB)" />
    );
    expect(lastFrame()).toBe(`${ICON_OK} out.zefer (1.0 KB)`);
    unmount();
  });

  it('falls back to "Done" when no message is given', () => {
    const { lastFrame, unmount } = render(
      <StatusLine progress={null} done={true} error={null} />
    );
    expect(lastFrame()).toBe(`${ICON_OK} Done`);
    unmount();
  });

  it("shows an initializing spinner before the first progress state", () => {
    const { lastFrame, unmount } = render(
      <StatusLine progress={null} done={false} error={null} />
    );
    expect(lastFrame()).toContain("Initializing...");
    expect(lastFrame()).toContain(SPINNER_FRAMES[0]);
    unmount();
  });

  it("shows the stage label and progress bar while running", () => {
    const { lastFrame, unmount } = render(
      <StatusLine progress={progress} done={false} error={null} />
    );
    expect(lastFrame()).toContain("Encrypting");
    expect(lastFrame()).toContain(" 42%");
    unmount();
  });

  it("renders a stage that has no colour mapping", () => {
    const { lastFrame, unmount } = render(
      <StatusLine
        progress={{ stage: "idle", percent: 0, label: "Idle" }}
        done={false}
        error={null}
      />
    );
    expect(lastFrame()).toContain("Idle");
    unmount();
  });
});
