/**
 * `zefer analyze` — the full password report view.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { AnalyzeApp } from "../analyze.js";
import { ICON_ARROW, ICON_OK, ICON_ERR } from "../../utils/terminal.js";

function frameOf(password: string): string {
  const { lastFrame, unmount } = render(<AnalyzeApp password={password} />);
  const frame = lastFrame()!;
  unmount();
  return frame;
}

describe("AnalyzeApp — strong password", () => {
  const frame = frameOf("Kq7#mZr2$vXp9!Lw");

  it("shows the header with the character count", () => {
    expect(frame).toContain(`${ICON_ARROW} zefer analyze`);
    expect(frame).toContain("16 chars");
  });

  it("lists every metric row", () => {
    for (const label of [
      "Length",
      "Estimated alphabet",
      "Maximum entropy",
      "Effective entropy",
      "Total keyspace",
      "Post-quantum entropy",
    ]) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain("95 symbols");
  });

  it("lists all four attack scenarios", () => {
    for (const label of ["Throttled login", "Cloud vs PBKDF2", "GPU farm", "Nation-state"]) {
      expect(frame).toContain(label);
    }
  });

  it("lists every framework check with a pass or fail marker", () => {
    for (const label of ["NIST SP 800-63B", "OWASP baseline", "Long-term protection"]) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain(ICON_OK);
  });

  it("reports an advantage over the average human password", () => {
    expect(frame).toContain("vs average human (~40 bits)");
    expect(frame).toContain("more combinations");
  });

  it("omits the weaknesses section when there are none", () => {
    expect(frame).not.toContain("Detected weaknesses");
  });
});

describe("AnalyzeApp — weak password", () => {
  const frame = frameOf("password");

  it("shows a very weak score and the leak warning", () => {
    expect(frame).toContain("very weak");
    expect(frame).toContain("Detected weaknesses");
    expect(frame).toContain("Appears in leaked password lists");
  });

  it("reports failing framework checks", () => {
    expect(frame).toContain(ICON_ERR);
    expect(frame).toContain("AES-128 equivalent");
  });

  it("reports being below the human average", () => {
    expect(frame).toContain("below the human average");
  });

  it("shows an instant crack time against the fastest attacker", () => {
    expect(frame).toContain("instant");
  });
});

describe("AnalyzeApp — crack-time formatting", () => {
  it("renders plain buckets, year counts and scientific notation together", () => {
    // ~60 effective bits spans four different buckets across the scenarios.
    const frame = frameOf("Zmvkspn9!qTr4");
    expect(frame).toMatch(/≈10[⁰¹²³⁴⁵⁶⁷⁸⁹]+ years/); // slow attacker → exponent form
    expect(frame).toMatch(/\d+ (seconds|minutes|hours|days|months|years)/); // fast attacker
  });

  it("handles the empty password without crashing", () => {
    const frame = frameOf("");
    expect(frame).toContain("0 chars");
    expect(frame).toContain("very weak");
    expect(frame).toContain("instant");
  });
});
