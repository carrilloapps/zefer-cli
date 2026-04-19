/**
 * Interactive prompts — cross-platform (Windows, macOS, Linux).
 *
 * Password input:
 *   - Unix TTY    → setRawMode + '*' masking
 *   - Windows TTY → readline muted output (no echo)
 *   - Piped stdin → read raw bytes from stdin
 */

import * as readline from "readline";

/** True when stdin supports setRawMode (Unix TTYs, Windows Terminal, PowerShell 7+). */
function canSetRawMode(): boolean {
  return (
    process.stdin.isTTY === true &&
    typeof (process.stdin as NodeJS.ReadStream & { setRawMode?: unknown }).setRawMode === "function"
  );
}

/**
 * Prompt for a secret value (no echo on any platform).
 */
export async function promptPassword(message: string): Promise<string> {
  // Non-interactive (piped): read from stdin
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf-8").trim();
  }

  // Raw mode available (Unix / Windows Terminal / PowerShell 7+): mask with '*'
  if (canSetRawMode()) {
    return promptPasswordRaw(message);
  }

  // Fallback: readline with muted output (cmd.exe, Git Bash without PTY, etc.)
  return promptPasswordMuted(message);
}

/** Raw-mode password prompt — shows '*' per character, handles Backspace / Ctrl-C. */
function promptPasswordRaw(message: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(message);
    const stdin = process.stdin as NodeJS.ReadStream;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    let password = "";

    function onData(char: string) {
      switch (char) {
        case "\n":
        case "\r":
        case "\u0004": // Ctrl-D (EOF)
          finish();
          resolve(password);
          break;
        case "\u0003": // Ctrl-C
          finish();
          process.stdout.write("\n");
          process.exit(1);
          break;
        case "\x7f": // DEL (Backspace on most terminals)
        case "\b":   // BS
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write("\b \b");
          }
          break;
        default:
          // Ignore control characters
          if (char >= " ") {
            password += char;
            process.stdout.write("*");
          }
      }
    }

    function finish() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
    }

    stdin.on("data", onData);
  });
}

/**
 * Readline-based muted prompt — works on cmd.exe, MinGW, Git Bash without PTY.
 * Characters are not echoed by monkey-patching _writeToOutput.
 */
function promptPasswordMuted(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Suppress echoed characters but allow the newline through
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s === "\r\n" || s === "\n" || s === "\r") {
        process.stdout.write("\n");
      }
      // All other output (the typed characters) is silently dropped
    };

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Prompt for a regular (visible) text value.
 */
export async function promptText(message: string, defaultValue?: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return defaultValue ?? "";
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const prompt = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `;
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

/**
 * Prompt for a yes/no confirmation.
 */
export async function promptConfirm(message: string, defaultYes = false): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await promptText(`${message} ${hint}`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

/**
 * Prompt for an integer value.
 */
export async function promptInt(message: string, defaultValue: number): Promise<number> {
  const answer = await promptText(message, String(defaultValue));
  const parsed = parseInt(answer, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}
