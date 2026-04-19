/**
 * Decrypt command — Ink UI component.
 *
 * Reads a .zefer file, decrypts it, writes output or prints to stdout.
 * Handles all security features: secret question, IP restriction, expiration, max attempts.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import * as fs from "fs";
import * as path from "path";
import { decodeZefer, parseFile } from "../lib/zefer.js";
import { createDecryptTracker, type ProgressState } from "../lib/progress.js";
import { Header } from "../ui/Header.js";
import { StatusLine } from "../ui/StatusLine.js";
import { formatBytes, formatTimeRemaining, formatDate } from "../utils/format.js";

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

// ─── File header preview (shown before decryption) ───

function FileInfo({ input }: { input: string }) {
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

export function DecryptApp(opts: DecryptOptions) {
  const { exit } = useApp();
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputInfo, setOutputInfo] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [question, setQuestion] = useState<string | null>(null);

  useEffect(() => {
    const startTime = Date.now();

    async function run() {
      try {
        setStage("reading");
        const tracker = createDecryptTracker(setProgress);
        tracker.reading();

        let rawBytes: Buffer;
        let fileContent: string;
        let inputLabel: string;

        if (opts.input === "-") {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
          rawBytes = Buffer.concat(chunks);
          fileContent = rawBytes.toString("utf-8");
          inputLabel = `stdin (${formatBytes(rawBytes.length)})`;
        } else {
          rawBytes = fs.readFileSync(opts.input);
          fileContent = rawBytes.toString("utf-8");
          inputLabel = `${path.basename(opts.input)} (${formatBytes(rawBytes.length)})`;
        }

        tracker.readingDone();

        // Quick parse to check for secret question (before full decrypt)
        const parsed = parseFile(fileContent, rawBytes);
        if (!parsed) {
          throw new Error("Invalid or unrecognized .zefer file format");
        }

        setStage("decrypting");
        const result = await decodeZefer(fileContent, opts.passphrase, {
          secondPassphrase: opts.secondPassphrase,
          questionAnswer: opts.questionAnswer,
          rawBytes,
          onProgress: {
            deriving: tracker.deriving.bind(tracker),
            derivingDone: tracker.derivingDone.bind(tracker),
            decrypting: tracker.decrypting.bind(tracker),
            decompressing: tracker.decompressing.bind(tracker),
            verifying: tracker.verifying.bind(tracker),
          },
        });

        if (!result.ok) {
          const messages: Record<string, string> = {
            wrong_passphrase: "Wrong passphrase",
            expired: "This file has expired",
            wrong_answer: "Wrong secret question answer",
            max_attempts: "Maximum decryption attempts exceeded",
            ip_blocked: "Your IP address is not in the allowlist",
            needs_answer: `Secret question required: ${parsed.header.mode}`,
            invalid_format: "Invalid file format",
          };
          throw new Error(messages[result.error] ?? result.error);
        }

        const { payload, header } = result;
        const meta = payload.meta;

        setStage("writing");
        tracker.writing();

        if (header.mode === "file" && payload.fileData) {
          // File mode: write to output path
          const outPath =
            opts.output ??
            (meta.fileName ? path.join(process.cwd(), meta.fileName) : `${opts.input}.dec`);

          if (fs.existsSync(outPath) && !opts.force) {
            throw new Error(`Output file "${outPath}" already exists. Use --force to overwrite.`);
          }

          fs.writeFileSync(outPath, payload.fileData);
          setOutputInfo(`${outPath} (${formatBytes(payload.fileData.length)})`);
        } else if (header.mode === "text" && payload.content !== null) {
          // Text mode
          if (opts.output) {
            if (fs.existsSync(opts.output) && !opts.force) {
              throw new Error(`Output file "${opts.output}" already exists. Use --force to overwrite.`);
            }
            fs.writeFileSync(opts.output, payload.content, "utf-8");
            setOutputInfo(`${opts.output} (${formatBytes(Buffer.byteLength(payload.content, "utf-8"))})`);
          } else {
            // Print to stdout (after Ink exits)
            setOutputInfo(`stdout (${formatBytes(Buffer.byteLength(payload.content, "utf-8"))})`);
            // Store content to write after exit
            (globalThis as Record<string, unknown>).__zefer_stdout_content = payload.content;
          }
        }

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
        title="zefer decrypt"
        subtitle={opts.input !== "-" ? path.basename(opts.input) : "stdin"}
      />

      {opts.verbose && <FileInfo input={opts.input} />}

      <StatusLine
        progress={progress}
        done={isDone}
        error={error}
        doneMessage={`${outputInfo}${elapsedMs > 0 ? ` in ${elapsedMs}ms` : ""}`}
      />
    </Box>
  );
}
