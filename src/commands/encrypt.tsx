/**
 * Encrypt command — Ink UI component.
 *
 * Reads a file (or stdin), encrypts it with AES-256-GCM, writes .zefer output.
 * Renders a real-time progress bar during the operation.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import * as fs from "node:fs";
import * as path from "node:path";
import { encodeZefer } from "../lib/zefer.js";
import { benchmarkDevice } from "../lib/crypto.js";
import { createEncryptTracker, type ProgressState } from "../lib/progress.js";
import type { CompressionMethod } from "../lib/compression.js";
import { Header } from "../ui/Header.js";
import { StatusLine } from "../ui/StatusLine.js";
import { formatBytes, formatDate } from "../utils/format.js";

export interface EncryptOptions {
  input: string; // file path or "-" for stdin
  output: string; // file path
  passphrase: string;
  secondPassphrase?: string;
  revealKey?: string;
  textContent?: string; // set when encrypting text directly (--text)
  hint?: string;
  note?: string;
  question?: string;
  questionAnswer?: string;
  ttl: number; // minutes, 0 = never
  iterations?: number; // 0 = auto-benchmark
  compression: CompressionMethod;
  maxAttempts: number;
  allowedIps: string[];
  dualKey: boolean;
  verbose: boolean;
}

type Stage =
  | "idle"
  | "reading"
  | "benchmarking"
  | "encrypting"
  | "writing"
  | "done"
  | "error";

/** Everything `encodeZefer` needs about the input, plus a label for the UI. */
interface EncryptSource {
  content?: string;
  fileData?: Buffer;
  fileName: string | null;
  fileType?: string;
  label: string;
}

/** Resolve the input — inline text, stdin, or a file on disk. */
async function readSource(opts: EncryptOptions): Promise<EncryptSource> {
  if (opts.textContent !== undefined) {
    const content = opts.textContent;
    const size = formatBytes(Buffer.byteLength(content, "utf-8"));
    return { content, fileName: null, label: `text (${size})` };
  }

  if (opts.input === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const fileData = Buffer.concat(chunks);
    return { fileData, fileName: null, label: `stdin (${formatBytes(fileData.length)})` };
  }

  const stat = fs.statSync(opts.input);
  const fileData = fs.readFileSync(opts.input);
  const fileName = path.basename(opts.input);
  const ext = path.extname(opts.input).slice(1).toLowerCase();
  return {
    fileData,
    fileName,
    fileType: ext ? `application/${ext}` : "application/octet-stream",
    label: `${fileName} (${formatBytes(stat.size)})`,
  };
}

/**
 * Pick a PBKDF2 iteration count. A caller-supplied value always wins; otherwise
 * benchmark the device and target roughly one second of derivation.
 */
async function resolveIterations(requested: number | undefined): Promise<number> {
  if (requested && requested > 0) return requested;

  const msFor100k = await benchmarkDevice();
  if (msFor100k < 200) return 1_000_000;
  if (msFor100k < 400) return 600_000;
  return 300_000;
}

export function EncryptApp(opts: Readonly<EncryptOptions>) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputInfo, setInputInfo] = useState<string>("");
  const [outputInfo, setOutputInfo] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startTime = Date.now();

    async function run() {
      try {
        setStage("reading");
        const tracker = createEncryptTracker(setProgress);
        tracker.reading();

        const source = await readSource(opts);
        setInputInfo(source.label);
        tracker.readingDone();

        if (!opts.iterations) setStage("benchmarking");
        const iterations = await resolveIterations(opts.iterations);

        const expiresAt =
          opts.ttl > 0 ? Date.now() + opts.ttl * 60 * 1000 : 0;

        setStage("encrypting");
        const result = await encodeZefer({
          content: source.content,
          fileData: source.fileData,
          passphrase: opts.passphrase,
          secondPassphrase: opts.secondPassphrase,
          revealKey: opts.revealKey,
          fileName: source.fileName,
          fileType: source.fileType,
          expiresAt,
          hint: opts.hint,
          note: opts.note,
          question: opts.question,
          questionAnswer: opts.questionAnswer,
          maxAttempts: opts.maxAttempts,
          iterations,
          dualKey: opts.dualKey,
          compression: opts.compression,
          allowedIps: opts.allowedIps,
          onProgress: {
            compressing: tracker.compressing.bind(tracker),
            compressingDone: tracker.compressingDone.bind(tracker),
            deriving: tracker.deriving.bind(tracker),
            derivingDone: tracker.derivingDone.bind(tracker),
            encrypting: tracker.encrypting.bind(tracker),
            packaging: tracker.packaging.bind(tracker),
          },
        });

        setStage("writing");
        tracker.writing();
        fs.writeFileSync(opts.output, result);
        setOutputInfo(`${opts.output} (${formatBytes(result.length)})`);

        tracker.done();
        setElapsedMs(Date.now() - startTime);
        setStage("done");
        setTimeout(() => exit(), 100);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStage("error");
        setTimeout(() => exit(new Error(msg)), 100);
      }
    }

    run();
  }, []);

  const isDone = stage === "done";
  const isError = stage === "error";
  const elapsedSuffix = elapsedMs > 0 ? ` in ${elapsedMs}ms` : "";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        title="zefer encrypt"
        subtitle={inputInfo ? `${inputInfo} → ${opts.output}` : undefined}
      />

      {opts.verbose && !isDone && !isError && (
        <Box flexDirection="column" marginBottom={1}>
          {opts.hint && (
            <Text color="gray">  hint:         {opts.hint}</Text>
          )}
          {opts.note && (
            <Text color="gray">  note:         {opts.note}</Text>
          )}
          {opts.question && (
            <Text color="gray">  question:     {opts.question}</Text>
          )}
          {opts.ttl > 0 && (
            <Text color="gray">
              {"  expires:      "}
              {formatDate(Date.now() + opts.ttl * 60 * 1000)}
            </Text>
          )}
          {opts.maxAttempts > 0 && (
            <Text color="gray">  max attempts: {opts.maxAttempts}</Text>
          )}
          {opts.dualKey && (
            <Text color="yellow">  dual-key mode enabled</Text>
          )}
          {opts.revealKey && (
            <Text color="yellow">  reveal key enabled (ZEFR3 format)</Text>
          )}
          {opts.allowedIps.length > 0 && (
            <Text color="gray">  allowed IPs:  {opts.allowedIps.join(", ")}</Text>
          )}
        </Box>
      )}

      <StatusLine
        progress={progress}
        done={isDone}
        error={error}
        doneMessage={`${outputInfo}${elapsedSuffix}`}
      />
    </Box>
  );
}
