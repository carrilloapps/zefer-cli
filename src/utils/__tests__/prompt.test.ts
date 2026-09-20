/**
 * Interactive prompts. `process.stdin` is swapped for a controllable stream so
 * every platform strategy (piped, raw-mode TTY, muted readline) is exercised.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { PassThrough, Readable } from "node:stream";
import { promptPassword, promptText, promptConfirm, promptInt } from "../prompt.js";

const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;

function setStdin(stream: NodeJS.ReadableStream): void {
  Object.defineProperty(process, "stdin", { value: stream, configurable: true });
}

/** A TTY-like stdin. `rawMode` mirrors the two Windows/Unix strategies. */
function ttyStdin(rawMode: boolean) {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  stream.isTTY = true;
  if (rawMode) stream.setRawMode = vi.fn();
  setStdin(stream as unknown as NodeJS.ReadableStream);
  return stream;
}

/** A piped (non-TTY) stdin that yields `data` and then ends. */
function pipedStdin(data: string) {
  const stream = Readable.from([data]) as Readable & { isTTY?: boolean };
  stream.isTTY = undefined;
  setStdin(stream as unknown as NodeJS.ReadableStream);
  return stream;
}

const tick = () => new Promise((r) => setImmediate(r));

afterEach(() => {
  Object.defineProperty(process, "stdin", realStdin);
  vi.restoreAllMocks();
});

describe("promptPassword — piped stdin", () => {
  it("reads the whole pipe and trims the trailing newline", async () => {
    pipedStdin("  s3cret-pass\n");
    expect(await promptPassword("Passphrase: ")).toBe("s3cret-pass");
  });

  it("returns an empty string for an empty pipe", async () => {
    pipedStdin("");
    expect(await promptPassword("Passphrase: ")).toBe("");
  });
});

describe("promptPassword — raw-mode TTY", () => {
  it("masks each character with '*' and returns the typed value on Enter", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(true);

    const pending = promptPassword("Passphrase: ");
    await tick();
    for (const char of "hunter2") stdin.write(char);
    stdin.write("\r");

    expect(await pending).toBe("hunter2");
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
    const written = out.mock.calls.map((c) => c[0]).join("");
    expect(written).toBe("Passphrase: " + "*".repeat(7) + "\n");
    expect(written).not.toContain("hunter2");
  });

  it.each(["\n", "\u0004"])("also submits on %j", async (terminator) => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(true);
    const pending = promptPassword("p: ");
    await tick();
    stdin.write("ab");
    stdin.write(terminator);
    expect(await pending).toBe("ab");
  });

  it.each(["\x7f", "\b"])("deletes the last character on %j", async (backspace) => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(true);
    const pending = promptPassword("p: ");
    await tick();
    stdin.write("abc");
    stdin.write(backspace);
    stdin.write("\r");

    expect(await pending).toBe("ab");
    expect(out.mock.calls.map((c) => c[0])).toContain("\b \b");
  });

  it("ignores a backspace on an empty buffer", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(true);
    const pending = promptPassword("p: ");
    await tick();
    stdin.write("\x7f");
    stdin.write("ok");
    stdin.write("\r");

    expect(await pending).toBe("ok");
    expect(out.mock.calls.map((c) => c[0])).not.toContain("\b \b");
  });

  it("ignores control characters below space", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(true);
    const pending = promptPassword("p: ");
    await tick();
    stdin.write("a");
    stdin.write("\u0001"); // Ctrl-A
    stdin.write("\t");
    stdin.write("b");
    stdin.write("\r");
    expect(await pending).toBe("ab");
  });

  it("restores the terminal and exits(1) on Ctrl-C", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const stdin = ttyStdin(true);

    void promptPassword("p: ");
    await tick();
    stdin.write("secret");
    stdin.write("\u0003");
    await tick();

    expect(exit).toHaveBeenCalledWith(1);
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });
});

describe("promptPassword — muted readline fallback", () => {
  it("returns the answer without echoing the typed characters", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(false); // TTY without setRawMode → readline fallback

    const pending = promptPassword("Passphrase: ");
    await tick();
    stdin.write("cmd-exe-pass\r\n");

    expect(await pending).toBe("cmd-exe-pass");
    const written = out.mock.calls.map((c) => String(c[0])).join("");
    expect(written).not.toContain("cmd-exe-pass");
    expect(written).toContain("\n");
  });
});

describe("promptText", () => {
  it("returns the default without prompting when stdin is piped", async () => {
    pipedStdin("ignored");
    expect(await promptText("Name", "fallback")).toBe("fallback");
  });

  it("returns an empty string when stdin is piped and there is no default", async () => {
    pipedStdin("ignored");
    expect(await promptText("Name")).toBe("");
  });

  it("returns the trimmed answer on a TTY", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(false);
    const pending = promptText("Name");
    await tick();
    stdin.write("  Ada  \r\n");
    expect(await pending).toBe("Ada");
  });

  it("shows the default in the prompt and falls back to it on an empty answer", async () => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(false);
    const pending = promptText("Name", "Ada");
    await tick();
    stdin.write("\r\n");

    expect(await pending).toBe("Ada");
    expect(out.mock.calls.map((c) => String(c[0])).join("")).toContain("Name [Ada]: ");
  });

  it("returns an empty string for an empty answer with no default", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(false);
    const pending = promptText("Name");
    await tick();
    stdin.write("   \r\n");
    expect(await pending).toBe("");
  });
});

describe("promptConfirm", () => {
  it.each([true, false])("returns the default (%s) when stdin is piped", async (fallback) => {
    pipedStdin("y");
    expect(await promptConfirm("Overwrite?", fallback)).toBe(fallback);
  });

  it("defaults to false when no default is given", async () => {
    pipedStdin("y");
    expect(await promptConfirm("Overwrite?")).toBe(false);
  });

  it.each([
    ["y", true],
    ["Yes", true],
    ["n", false],
    ["whatever", false],
  ])("maps the answer %j to %s", async (answer, expected) => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(false);
    const pending = promptConfirm("Overwrite?");
    await tick();
    stdin.write(`${answer}\r\n`);
    expect(await pending).toBe(expected);
  });

  it.each([
    [true, "[Y/n]"],
    [false, "[y/N]"],
  ])("renders the %s hint as %s and keeps the default on Enter", async (fallback, hint) => {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(false);
    const pending = promptConfirm("Overwrite?", fallback);
    await tick();
    stdin.write("\r\n");

    expect(await pending).toBe(fallback);
    expect(out.mock.calls.map((c) => String(c[0])).join("")).toContain(`Overwrite? ${hint}`);
  });
});

describe("promptInt", () => {
  it("parses a numeric answer", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(false);
    const pending = promptInt("Iterations", 600_000);
    await tick();
    stdin.write("300000\r\n");
    expect(await pending).toBe(300_000);
  });

  it("falls back to the default when the answer is not a number", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stdin = ttyStdin(false);
    const pending = promptInt("Iterations", 600_000);
    await tick();
    stdin.write("lots\r\n");
    expect(await pending).toBe(600_000);
  });

  it("returns the default unchanged when stdin is piped", async () => {
    pipedStdin("42");
    expect(await promptInt("Iterations", 600_000)).toBe(600_000);
  });
});
