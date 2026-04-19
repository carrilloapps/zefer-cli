/**
 * Encrypt command — Ink UI component.
 *
 * Reads a file (or stdin), encrypts it with AES-256-GCM, writes .zefer output.
 * Renders a real-time progress bar during the operation.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import * as fs from "fs";
import * as path from "path";
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

export function EncryptApp(opts: EncryptOptions) {
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

        let fileData: Buffer | undefined;
        let fileName: string | null = null;
        let fileType: string | undefined;
        let content: string | undefined;

        if (opts.textContent !== undefined) {
          // Text mode
          content = opts.textContent;
          fileName = null;
          setInputInfo(`text (${formatBytes(Buffer.byteLength(content, "utf-8"))})`);
        } else if (opts.input === "-") {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
          const buf = Buffer.concat(chunks);
          fileData = buf;
          fileName = null;
          setInputInfo(`stdin (${formatBytes(buf.length)})`);
        } else {
          const stat = fs.statSync(opts.input);
          fileData = fs.readFileSync(opts.input);
          fileName = path.basename(opts.input);
          const ext = path.extname(opts.input).slice(1).toLowerCase();
          fileType = ext ? `application/${ext}` : "application/octet-stream";
          setInputInfo(`${fileName} (${formatBytes(stat.size)})`);
        }

        tracker.readingDone();

        // Auto-benchmark if iterations not specified
        let iterations = opts.iterations;
        if (!iterations || iterations === 0) {
          setStage("benchmarking");
          const msFor100k = await benchmarkDevice();
          // Target ~1 second of derivation
          if (msFor100k < 200) iterations = 1_000_000;
          else if (msFor100k < 400) iterations = 600_000;
          else iterations = 300_000;
        }

        const expiresAt =
          opts.ttl > 0 ? Date.now() + opts.ttl * 60 * 1000 : 0;

        setStage("encrypting");
        const result = await encodeZefer({
          content,
          fileData,
          passphrase: opts.passphrase,
          secondPassphrase: opts.secondPassphrase,
          revealKey: opts.revealKey,
          fileName,
          fileType,
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
        doneMessage={`${outputInfo}${elapsedMs > 0 ? ` in ${elapsedMs}ms` : ""}`}
      />
    </Box>
  );
}
