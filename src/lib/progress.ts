/**
 * Real-time progress tracking for encrypt/decrypt operations.
 * Identical logic to the browser version — stage weights match exactly.
 */

export type CryptoStage =
  | "idle"
  | "reading"
  | "compressing"
  | "deriving"
  | "encrypting"
  | "packaging"
  | "decompressing"
  | "decrypting"
  | "verifying"
  | "writing"
  | "done";

export interface ProgressState {
  stage: CryptoStage;
  percent: number; // 0–100, always real chunk-based progress
  label: string;
}

export type ProgressCallback = (state: ProgressState) => void;

const STAGE_LABELS: Record<CryptoStage, string> = {
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

export function stageLabel(stage: CryptoStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

/**
 * Encrypt tracker:
 *   reading:     0–5%
 *   compressing: 5–15%
 *   deriving:    15–20%
 *   encrypting:  20–95%  (real chunk progress)
 *   packaging:   95–98%
 *   writing:     98–100%
 */
export function createEncryptTracker(onProgress: ProgressCallback) {
  function set(stage: CryptoStage, percent: number) {
    onProgress({ stage, percent: Math.min(Math.round(percent), 100), label: stageLabel(stage) });
  }

  return {
    reading() {
      set("reading", 0);
    },
    readingDone() {
      set("reading", 5);
    },
    compressing(p: number) {
      set("compressing", 5 + p * 0.1);
    },
    compressingDone() {
      set("compressing", 15);
    },
    deriving() {
      set("deriving", 15);
    },
    derivingDone() {
      set("deriving", 20);
    },
    encrypting(chunkIndex: number, totalChunks: number) {
      set("encrypting", 20 + (chunkIndex / totalChunks) * 75);
    },
    packaging() {
      set("packaging", 95);
    },
    writing() {
      set("writing", 98);
    },
    done() {
      set("done", 100);
    },
  };
}

/**
 * Decrypt tracker:
 *   reading:      0–5%
 *   deriving:     5–10%
 *   decrypting:   10–85%  (real chunk progress)
 *   decompressing: 85–95%
 *   verifying:    95–98%
 *   writing:      98–100%
 */
export function createDecryptTracker(onProgress: ProgressCallback) {
  function set(stage: CryptoStage, percent: number) {
    onProgress({ stage, percent: Math.min(Math.round(percent), 100), label: stageLabel(stage) });
  }

  return {
    reading() {
      set("reading", 0);
    },
    readingDone() {
      set("reading", 5);
    },
    deriving() {
      set("deriving", 5);
    },
    derivingDone() {
      set("deriving", 10);
    },
    decrypting(chunkIndex: number, totalChunks: number) {
      set("decrypting", 10 + (chunkIndex / totalChunks) * 75);
    },
    decompressing() {
      set("decompressing", 85);
    },
    verifying() {
      set("verifying", 95);
    },
    writing() {
      set("writing", 98);
    },
    done() {
      set("done", 100);
    },
  };
}
