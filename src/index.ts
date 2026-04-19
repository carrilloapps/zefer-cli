/**
 * zefer-cli — AES-256-GCM file and text encryption
 *
 * Commands:
 *   zefer encrypt <input> [options]   — encrypt a file or text
 *   zefer decrypt <input> [options]   — decrypt a .zefer file
 *   zefer keygen [options]            — generate a secure key
 *   zefer info <input>                — show public header without decrypting
 *
 * All operations match the zefer web app (https://zefer.carrillo.app) exactly.
 * Files are fully cross-compatible between CLI and browser.
 */

import { Command } from "commander";
import { render } from "ink";
import React from "react";
import * as path from "path";
import * as fs from "fs";

import { EncryptApp, type EncryptOptions } from "./commands/encrypt.js";
import { DecryptApp, type DecryptOptions } from "./commands/decrypt.js";
import { KeygenApp, type KeygenOptions } from "./commands/keygen.js";
import { InfoApp } from "./commands/info.js";
import { promptPassword, promptText, promptConfirm } from "./utils/prompt.js";
import { createRequire } from "module";
import type { CompressionMethod } from "./lib/compression.js";
import type { KeygenMode } from "./lib/keygen.js";

const _require = createRequire(import.meta.url);
const { version: PKG_VERSION } = _require("../package.json") as { version: string };

// ─── Version ───

const VERSION = PKG_VERSION;

// ─── Output after stdout-printed content ───

process.on("exit", () => {
  const content = (globalThis as Record<string, unknown>).__zefer_stdout_content;
  if (typeof content === "string") {
    process.stdout.write(content);
    if (!content.endsWith("\n")) process.stdout.write("\n");
  }
});

// ─── Root program ───

const program = new Command();

program
  .name("zefer")
  .description("AES-256-GCM file and text encryption — zefer.carrillo.app")
  .version(VERSION, "-v, --version")
  .addHelpText(
    "after",
    `
Examples:
  zefer encrypt document.pdf -p mypassword
  zefer encrypt -t "my secret note" -p mypassword -o note.zefer
  zefer decrypt document.pdf.zefer -p mypassword
  zefer keygen --mode secure --length 64
  zefer info secret.zefer
`
  );

// ─── encrypt ───

program
  .command("encrypt")
  .description("Encrypt a file or text with AES-256-GCM")
  .argument("[input]", 'Input file path (use "-" for stdin, or --text for direct text)')
  .option("-o, --output <path>", "Output file path (default: <input>.zefer)")
  .option("-p, --passphrase <pass>", "Passphrase (prompted if not provided)")
  .option("-2, --second <pass>", "Second passphrase (dual-key mode)")
  .option("-r, --reveal <key>", "Reveal key — creates ZEFR3 dual-block file")
  .option("-t, --text <content>", "Encrypt text directly instead of a file")
  .option("--hint <hint>", "Public hint (visible without passphrase)")
  .option("--note <note>", "Public note (visible without passphrase)")
  .option("-q, --question <question>", "Secret question")
  .option("-a, --answer <answer>", "Secret question answer")
  .option(
    "--ttl <minutes>",
    "Expiration in minutes (0 = never, default: 0)",
    (v) => parseInt(v, 10),
    0
  )
  .option(
    "-i, --iterations <n>",
    "PBKDF2 iterations (0 = auto-benchmark, default: 0)",
    (v) => parseInt(v, 10),
    0
  )
  .option(
    "-c, --compression <method>",
    "Compression: none|gzip|deflate|deflate-raw (default: none)",
    "none"
  )
  .option("--max-attempts <n>", "Max decryption attempts (0 = unlimited)", (v) => parseInt(v, 10), 0)
  .option("--allowed-ips <ips>", "Comma-separated IP allowlist")
  .option("--dual-key", "Enable dual-key mode (requires --second)", false)
  .option("--verbose", "Show operation details", false)
  .action(async (input: string | undefined, options) => {
    const textContent: string | undefined = options.text;
    const hasInput = !!input || !!textContent || !process.stdin.isTTY;

    if (!hasInput) {
      console.error("Error: provide an input file, --text, or pipe data via stdin");
      process.exit(1);
    }

    // Resolve output path
    let output: string = options.output;
    if (!output) {
      if (textContent !== undefined) {
        output = "encrypted.zefer";
      } else if (input && input !== "-") {
        output = `${input}.zefer`;
      } else {
        output = "encrypted.zefer";
      }
    }

    // Prompt for passphrase if not provided
    let passphrase: string = options.passphrase ?? "";
    if (!passphrase) {
      passphrase = await promptPassword("Passphrase: ");
      if (!passphrase) {
        console.error("Error: passphrase is required");
        process.exit(1);
      }
    }

    // Prompt for second passphrase if dual-key and not provided
    let secondPassphrase: string | undefined = options.second;
    const dualKey = !!(options.dualKey || options.second);
    if (dualKey && !secondPassphrase) {
      secondPassphrase = await promptPassword("Second passphrase: ");
    }

    // Prompt for question answer if question provided but answer not
    let questionAnswer: string | undefined = options.answer;
    if (options.question && !questionAnswer) {
      questionAnswer = await promptPassword(`Answer to "${options.question}": `);
    }

    const allowedIps: string[] = options.allowedIps
      ? options.allowedIps.split(",").map((ip: string) => ip.trim()).filter(Boolean)
      : [];

    const encryptOpts: EncryptOptions = {
      input: input ?? "-",
      output,
      passphrase,
      secondPassphrase,
      revealKey: options.reveal,
      textContent,
      hint: options.hint,
      note: options.note,
      question: options.question,
      questionAnswer,
      ttl: options.ttl,
      iterations: options.iterations,
      compression: options.compression as CompressionMethod,
      maxAttempts: options.maxAttempts,
      allowedIps,
      dualKey,
      verbose: options.verbose,
    };

    const { waitUntilExit } = render(React.createElement(EncryptApp, encryptOpts));
    await waitUntilExit().catch(() => process.exit(1));
  });

// ─── decrypt ───

program
  .command("decrypt")
  .description("Decrypt a .zefer file")
  .argument("<input>", 'Input .zefer file path (use "-" for stdin)')
  .option("-o, --output <path>", "Output file path (default: stdout for text, original name for file)")
  .option("-p, --passphrase <pass>", "Passphrase (prompted if not provided)")
  .option("-2, --second <pass>", "Second passphrase (dual-key mode)")
  .option("-a, --answer <answer>", "Secret question answer (prompted if needed)")
  .option("--force", "Overwrite existing output file", false)
  .option("--verbose", "Show file info before decrypting", false)
  .action(async (input: string, options) => {
    // Prompt for passphrase if not provided
    let passphrase: string = options.passphrase ?? "";
    if (!passphrase) {
      passphrase = await promptPassword("Passphrase: ");
      if (!passphrase) {
        console.error("Error: passphrase is required");
        process.exit(1);
      }
    }

    const decryptOpts: DecryptOptions = {
      input,
      output: options.output,
      passphrase,
      secondPassphrase: options.second,
      questionAnswer: options.answer,
      force: options.force,
      verbose: options.verbose,
    };

    const { waitUntilExit } = render(React.createElement(DecryptApp, decryptOpts));

    try {
      await waitUntilExit();
    } catch {
      process.exit(1);
    }

    // Write stdout content after Ink exits (text mode without -o)
    const content = (globalThis as Record<string, unknown>).__zefer_stdout_content;
    if (typeof content === "string") {
      process.stdout.write(content);
      if (!content.endsWith("\n")) process.stdout.write("\n");
      delete (globalThis as Record<string, unknown>).__zefer_stdout_content;
    }
  });

// ─── keygen ───

program
  .command("keygen")
  .description("Generate a cryptographically secure key")
  .option(
    "-m, --mode <mode>",
    "Mode: alpha|hex|uuid|secure|unicode (default: secure)",
    "secure"
  )
  .option("-l, --length <n>", "Key length in characters (default: 64)", (v) => parseInt(v, 10), 64)
  .option("-n, --count <n>", "Number of keys to generate (default: 1)", (v) => parseInt(v, 10), 1)
  .action((options) => {
    const keygenOpts: KeygenOptions = {
      mode: options.mode as KeygenMode,
      length: options.length,
      count: options.count,
    };

    const { waitUntilExit } = render(React.createElement(KeygenApp, keygenOpts));
    waitUntilExit().then(() => {}).catch(() => {});
  });

// ─── info ───

program
  .command("info")
  .description("Show the public header of a .zefer file without decrypting")
  .argument("<input>", "Input .zefer file path")
  .action((input: string) => {
    const { waitUntilExit } = render(React.createElement(InfoApp, { input }));
    waitUntilExit().then(() => {
      // Auto-exit after rendering static info
      setTimeout(() => process.exit(0), 50);
    });
  });

// ─── Parse ───

program.parseAsync(process.argv).catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
