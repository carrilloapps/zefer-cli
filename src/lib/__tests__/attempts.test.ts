/**
 * ~/.zefer/attempts.json — the CLI stand-in for the web app's localStorage
 * attempt counter. `node:os` is mocked so the real home directory is untouched.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zefer-attempts-"));
const STORE = path.join(HOME, ".zefer", "attempts.json");

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof os>("node:os");
  return { ...actual, homedir: () => HOME };
});

const { getAttempts, setAttempts, removeAttempts } = await import("../attempts.js");

beforeEach(() => {
  fs.rmSync(path.join(HOME, ".zefer"), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe("getAttempts", () => {
  it("returns 0 when the store file does not exist", () => {
    expect(getAttempts("missing")).toBe(0);
  });

  it("returns 0 for a key that is not in an existing store", () => {
    setAttempts("other", 3);
    expect(getAttempts("missing")).toBe(0);
  });

  it.each([
    ["malformed JSON", "{ not json"],
    ["a JSON number", "42"],
    ["JSON null", "null"],
    ["a JSON array", "[1, 2, 3]"],
  ])("returns 0 when the store holds %s", (_label, contents) => {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, contents);
    expect(getAttempts("any")).toBe(0);
  });
});

describe("setAttempts / removeAttempts", () => {
  it("persists a counter, creating ~/.zefer on first write", () => {
    setAttempts("file-a", 2);
    expect(fs.existsSync(STORE)).toBe(true);
    expect(getAttempts("file-a")).toBe(2);
  });

  it("keeps other keys when updating one", () => {
    setAttempts("file-a", 1);
    setAttempts("file-b", 5);
    setAttempts("file-a", 4);
    expect(getAttempts("file-a")).toBe(4);
    expect(getAttempts("file-b")).toBe(5);
  });

  it("removes a single key and leaves the rest", () => {
    setAttempts("file-a", 1);
    setAttempts("file-b", 2);
    removeAttempts("file-a");
    expect(getAttempts("file-a")).toBe(0);
    expect(getAttempts("file-b")).toBe(2);
  });

  it("is a silent no-op when the store cannot be written", () => {
    // A plain file where the ~/.zefer directory should be: mkdirSync fails, so
    // the whole write path must swallow the error instead of crashing the CLI.
    fs.writeFileSync(path.join(HOME, ".zefer"), "not a directory");

    expect(() => setAttempts("file-a", 1)).not.toThrow();
    expect(() => removeAttempts("file-a")).not.toThrow();
    expect(getAttempts("file-a")).toBe(0);

    fs.rmSync(path.join(HOME, ".zefer"), { force: true });
  });
});
