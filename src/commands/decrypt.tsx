/**
 * Decrypt command — Ink UI component.
 *
 * Reads a .zefer file, decrypts it, writes output or prints to stdout.
 * Handles all security features: secret question, IP restriction, expiration, max attempts.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  decodeZefer,
  parseFile,
  type DecodeError,
  type ZeferHeader,
  type ZeferPayload,
} from "../lib/zefer.js";
import { createDecryptTracker, type ProgressState } from "../lib/progress.js";
import { Header } from "../ui/Header.js";
import { StatusLine } from "../ui/StatusLine.js";
import { formatBytes } from "../utils/format.js";
import { sanitizeOutputName } from "../utils/paths.js";

export interface DecryptOptions {
  input: string; // file path or "-" for stdin
  output?: string; // undefined = stdout for text, auto-name for file
  passphrase: string;
  secondPassphrase?: string;
  questionAnswer?: string;
  force: boolean; // overwrite existing output
  verbose: boolean;
}

type Stage = "idle" | "reading" | "decrypting" | "writing" | "done" | "error";

/** Human-readable message for every `decodeZefer` failure code. Keyed by
 *  `DecodeError`, so a new code cannot be added without a message here. */
const DECODE_ERRORS: Record<DecodeError, string> = {
  wrong_passphrase: "Wrong passphrase",
  expired: "This file has expired",
  wrong_answer: "Wrong secret question answer",
  max_attempts: "Maximum decryption attempts exceeded",
  ip_blocked: "Your IP address is not in the allowlist",
  needs_answer: "Secret question required",
  invalid_format: "Invalid file format",
};

// ─── Pure helpers (kept out of the component so `run()` stays linear) ───

/** Read the whole input — a file path, or stdin when the input is `-`. */
async function readInput(input: string): Promise<Buffer> {
  if (input !== "-") return fs.readFileSync(input);

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Throw when `outPath` exists and the user did not ask to overwrite it. */
function assertWritable(outPath: string, force: boolean): void {
  if (fs.existsSync(outPath) && !force) {
    throw new Error(`Output file "${outPath}" already exists. Use --force to overwrite.`);
  }
}

/** Write the decrypted file payload to disk. Returns the status line text. */
function writeFilePayload(opts: DecryptOptions, fileData: Buffer, fileName: string | null): string {
  // `fileName` comes from inside the encrypted payload, so it is controlled by
  // whoever produced the file — never trust it as a path.
  const outPath = opts.output ?? (fileName ? sanitizeOutputName(fileName) : `${opts.input}.dec`);
  assertWritable(outPath, opts.force);
  fs.writeFileSync(outPath, fileData);
  return `${outPath} (${formatBytes(fileData.length)})`;
}

/**
 * Write the decrypted text payload: to `--output` when given, otherwise staged
 * for stdout so it is printed after Ink releases the terminal.
 */
function writeTextPayload(opts: DecryptOptions, content: string): string {
  const size = formatBytes(Buffer.byteLength(content, "utf-8"));

  if (!opts.output) {
    (globalThis as Record<string, unknown>).__zefer_stdout_content = content;
    return `stdout (${size})`;
  }

  assertWritable(opts.output, opts.force);
  fs.writeFileSync(opts.output, content, "utf-8");
  return `${opts.output} (${size})`;
}

/** Persist a decrypted payload and return the status line text. */
function writePayload(opts: DecryptOptions, header: ZeferHeader, payload: ZeferPayload): string {
  if (header.mode === "file" && payload.fileData) {
    return writeFilePayload(opts, payload.fileData, payload.meta.fileName);
  }
  if (header.mode === "text" && payload.content !== null) {
    return writeTextPayload(opts, payload.content);
  }
  return "";
}

// ─── File header preview (shown before decryption) ───

function FileInfo({ input }: Readonly<{ input: string }>) {
  if (input === "-") return null;

  let rawBytes: Buffer;
  try {
    rawBytes = fs.readFileSync(input);
  } catch {
    return null;
  }

  const parsed = parseFile(rawBytes.toString("utf-8", 0, Math.min(rawBytes.length, 1024)), rawBytes);
  if (!parsed) return null;

  const { header } = parsed;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {header.hint && (
        <Box>
          <Text color="gray">  hint:       </Text>
          <Text color="yellow">{header.hint}</Text>
        </Box>
      )}
      {header.note && (
        <Box>
          <Text color="gray">  note:       </Text>
          <Text color="cyan">{header.note}</Text>
        </Box>
      )}
      <Box>
        <Text color="gray">  mode:       </Text>
        <Text>{header.mode}</Text>
      </Box>
      <Box>
        <Text color="gray">  iterations: </Text>
        <Text>{header.iterations.toLocaleString()}</Text>
      </Box>
      {header.compression !== "none" && (
        <Box>
          <Text color="gray">  compressed: </Text>
          <Text>{header.compression}</Text>
        </Box>
      )}
    </Box>
  );
}

export function DecryptApp(opts: Readonly<DecryptOptions>) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startTime = Date.now();

    async function run() {
      try {
        setStage("reading");
        const tracker = createDecryptTracker(setProgress);
        tracker.reading();

        const rawBytes = await readInput(opts.input);
        const fileContent = rawBytes.toString("utf-8");
        tracker.readingDone();

        if (!parseFile(fileContent, rawBytes)) {
          throw new Error("Invalid or unrecognized .zefer file format");
        }

        setStage("decrypting");
        const result = await decodeZefer(fileContent, opts.passphrase, {
          secondPassphrase: opts.secondPassphrase,
          questionAnswer: opts.questionAnswer,
          rawBytes,
          maxDecompressSize: 0, // CLI: no size cap — process any local file, show progress
          onProgress: {
            deriving: tracker.deriving.bind(tracker),
            derivingDone: tracker.derivingDone.bind(tracker),
            decrypting: tracker.decrypting.bind(tracker),
            decompressing: tracker.decompressing.bind(tracker),
            verifying: tracker.verifying.bind(tracker),
          },
        });

        if (!result.ok) {
          throw new Error(DECODE_ERRORS[result.error]);
        }

        setStage("writing");
        tracker.writing();
        setOutputInfo(writePayload(opts, result.header, result.payload));

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

  const elapsedSuffix = elapsedMs > 0 ? ` in ${elapsedMs}ms` : "";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header
        title="zefer decrypt"
        subtitle={opts.input !== "-" ? path.basename(opts.input) : "stdin"}
      />

      {opts.verbose && <FileInfo input={opts.input} />}

      <StatusLine
        progress={progress}
        done={stage === "done"}
        error={error}
        doneMessage={`${outputInfo}${elapsedSuffix}`}
      />
    </Box>
  );
}
