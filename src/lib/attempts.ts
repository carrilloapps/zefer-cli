/**
 * File-based attempt counter — CLI equivalent of the browser's localStorage.
 *
 * Stores decryption attempt counts at ~/.zefer/attempts.json.
 * Keys are a hash prefix of the encrypted content, same as the web app.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ATTEMPTS_DIR = path.join(os.homedir(), ".zefer");
const ATTEMPTS_FILE = path.join(ATTEMPTS_DIR, "attempts.json");

function readStore(): Record<string, number> {
  try {
    const text = fs.readFileSync(ATTEMPTS_FILE, "utf-8");
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, number>;
    return {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, number>): void {
  try {
    fs.mkdirSync(ATTEMPTS_DIR, { recursive: true });
    fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // Non-fatal — silently ignore write errors
  }
}

export function getAttempts(key: string): number {
  return readStore()[key] ?? 0;
}

export function setAttempts(key: string, count: number): void {
  const store = readStore();
  store[key] = count;
  writeStore(store);
}

export function removeAttempts(key: string): void {
  const store = readStore();
  delete store[key];
  writeStore(store);
}
