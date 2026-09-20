/**
 * Terminal capability detection. `supportsUnicode` is decided once at import,
 * so every case re-imports the module under a fresh environment.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const ENV_KEYS = ["ZEFER_ASCII", "ZEFER_UNICODE", "TERM", "CI", "WT_SESSION", "TERM_PROGRAM"];

const realEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const realPlatform = process.platform;

/** Re-import `terminal.ts` with a controlled environment and platform. */
async function load(env: Record<string, string>, platform: NodeJS.Platform = "linux") {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  vi.resetModules();
  return import("../terminal.js");
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (realEnv[key] === undefined) delete process.env[key];
    else process.env[key] = realEnv[key];
  }
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  vi.resetModules();
});

describe("supportsUnicode detection", () => {
  it("defaults to Unicode on a plain POSIX terminal", async () => {
    expect((await load({}, "linux")).supportsUnicode).toBe(true);
  });

  it("honours ZEFER_ASCII even when everything else says Unicode", async () => {
    expect((await load({ ZEFER_ASCII: "1", ZEFER_UNICODE: "1" }, "linux")).supportsUnicode).toBe(
      false
    );
  });

  it("honours ZEFER_UNICODE over TERM=dumb and CI", async () => {
    const mod = await load({ ZEFER_UNICODE: "1", TERM: "dumb", CI: "true" }, "win32");
    expect(mod.supportsUnicode).toBe(true);
  });

  it("falls back to ASCII for TERM=dumb", async () => {
    expect((await load({ TERM: "dumb" }, "linux")).supportsUnicode).toBe(false);
  });

  it("falls back to ASCII in CI", async () => {
    expect((await load({ CI: "true" }, "linux")).supportsUnicode).toBe(false);
  });

  it("keeps Unicode for a non-dumb TERM", async () => {
    expect((await load({ TERM: "xterm-256color" }, "darwin")).supportsUnicode).toBe(true);
  });

  it("falls back to ASCII on legacy Windows consoles", async () => {
    expect((await load({}, "win32")).supportsUnicode).toBe(false);
  });

  it("enables Unicode on Windows Terminal", async () => {
    expect((await load({ WT_SESSION: "abc" }, "win32")).supportsUnicode).toBe(true);
  });

  it("enables Unicode in the VS Code terminal on Windows", async () => {
    expect((await load({ TERM_PROGRAM: "vscode" }, "win32")).supportsUnicode).toBe(true);
  });

  it("keeps ASCII on Windows for another TERM_PROGRAM", async () => {
    expect((await load({ TERM_PROGRAM: "Apple_Terminal" }, "win32")).supportsUnicode).toBe(false);
  });
});

describe("glyph sets", () => {
  it("exposes the Unicode set when Unicode is supported", async () => {
    const t = await load({ ZEFER_UNICODE: "1" });
    expect(t.SPINNER_FRAMES).toHaveLength(10);
    expect(t.SPINNER_FRAMES[0]).toBe("⠋");
    expect([t.BAR_FILLED, t.BAR_EMPTY]).toEqual(["█", "░"]);
    expect([t.ICON_OK, t.ICON_ERR, t.ICON_ARROW, t.ICON_SEP]).toEqual(["✓", "✗", "▸", "─"]);
  });

  it("exposes pure-ASCII fallbacks otherwise", async () => {
    const t = await load({ ZEFER_ASCII: "1" });
    expect(t.SPINNER_FRAMES).toEqual(["-", "\\", "|", "/"]);
    expect([t.BAR_FILLED, t.BAR_EMPTY]).toEqual(["#", "-"]);
    expect([t.ICON_OK, t.ICON_ERR, t.ICON_ARROW, t.ICON_SEP]).toEqual(["OK", "ERR", ">", "-"]);
    const ascii = [...t.SPINNER_FRAMES, t.BAR_FILLED, t.BAR_EMPTY, t.ICON_OK, t.ICON_ERR].join("");
    expect([...ascii].every((c) => c.codePointAt(0)! < 128)).toBe(true);
  });
});
