/**
 * Progress trackers — the stage percentages must match the web app exactly.
 */

import { describe, it, expect, vi } from "vitest";
import {
  stageLabel,
  createEncryptTracker,
  createDecryptTracker,
  type CryptoStage,
  type ProgressState,
} from "../progress.js";

function collect(): { states: ProgressState[]; onProgress: (s: ProgressState) => void } {
  const states: ProgressState[] = [];
  return { states, onProgress: (s) => states.push(s) };
}

describe("stageLabel", () => {
  it("maps every known stage to its human label", () => {
    const expected: Record<CryptoStage, string> = {
      idle: "Idle",
      reading: "Reading file",
      compressing: "Compressing",
      deriving: "Deriving key",
      encrypting: "Encrypting",
      packaging: "Packaging",
      decompressing: "Decompressing",
      decrypting: "Decrypting",
      verifying: "Verifying",
      writing: "Writing file",
      done: "Done",
    };
    for (const [stage, label] of Object.entries(expected)) {
      expect(stageLabel(stage as CryptoStage)).toBe(label);
    }
  });

  it("falls back to the raw stage name for an unknown stage", () => {
    expect(stageLabel("teleporting" as CryptoStage)).toBe("teleporting");
  });
});

describe("createEncryptTracker", () => {
  it("walks reading → compressing → deriving → encrypting → packaging → writing → done", () => {
    const { states, onProgress } = collect();
    const t = createEncryptTracker(onProgress);

    t.reading();
    t.readingDone();
    t.compressing(50);
    t.compressingDone();
    t.deriving();
    t.derivingDone();
    t.encrypting(1, 2);
    t.encrypting(2, 2);
    t.packaging();
    t.writing();
    t.done();

    expect(states.map((s) => [s.stage, s.percent])).toEqual([
      ["reading", 0],
      ["reading", 5],
      ["compressing", 10],
      ["compressing", 15],
      ["deriving", 15],
      ["deriving", 20],
      ["encrypting", 58],
      ["encrypting", 95],
      ["packaging", 95],
      ["writing", 98],
      ["done", 100],
    ]);
  });

  it("labels each emitted state and never exceeds 100%", () => {
    const { states, onProgress } = collect();
    const t = createEncryptTracker(onProgress);
    t.encrypting(10, 1); // over-reported chunk index
    expect(states[0]).toEqual({ stage: "encrypting", percent: 100, label: "Encrypting" });
  });
});

describe("createDecryptTracker", () => {
  it("walks reading → deriving → decrypting → decompressing → verifying → writing → done", () => {
    const { states, onProgress } = collect();
    const t = createDecryptTracker(onProgress);

    t.reading();
    t.readingDone();
    t.deriving();
    t.derivingDone();
    t.decrypting(1, 2);
    t.decrypting(2, 2);
    t.decompressing();
    t.verifying();
    t.writing();
    t.done();

    expect(states.map((s) => [s.stage, s.percent])).toEqual([
      ["reading", 0],
      ["reading", 5],
      ["deriving", 5],
      ["deriving", 10],
      ["decrypting", 48],
      ["decrypting", 85],
      ["decompressing", 85],
      ["verifying", 95],
      ["writing", 98],
      ["done", 100],
    ]);
  });

  it("clamps an over-reported chunk index to 100%", () => {
    const onProgress = vi.fn();
    createDecryptTracker(onProgress).decrypting(5, 1);
    expect(onProgress).toHaveBeenCalledWith({
      stage: "decrypting",
      percent: 100,
      label: "Decrypting",
    });
  });
});
