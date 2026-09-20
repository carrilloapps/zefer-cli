/**
 * CLI entry point — argument wiring, MCP auto-detection and the stdout hand-off
 * that runs after Ink releases the terminal.
 *
 * `ink`'s renderer, the password prompt and the MCP server are replaced with
 * spies, so each case drives the real Commander program end to end without
 * painting a terminal or blocking on input.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import type * as InkModule from "ink";
import type * as PromptModule from "../utils/prompt.js";

interface RenderCall {
  type: unknown;
  props: Record<string, unknown>;
}

const rendered: RenderCall[] = [];
let exitResult: Promise<void> = Promise.resolve();
let renderThrows: unknown = null;
const promptAnswers: string[] = [];
const promptedFor: string[] = [];
const mcpStarts: string[] = [];

vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof InkModule>("ink");
  return {
    ...actual,
    render: (element: RenderCall) => {
      if (renderThrows !== null) throw renderThrows;
      rendered.push({ type: element.type, props: element.props });
      return { waitUntilExit: () => exitResult };
    },
  };
});

vi.mock("../utils/prompt.js", async () => {
  const actual = await vi.importActual<typeof PromptModule>("../utils/prompt.js");
  return {
    ...actual,
    promptPassword: (message: string) => {
      promptedFor.push(message);
      return Promise.resolve(promptAnswers.shift() ?? "");
    },
  };
});

vi.mock("../mcp/server.js", () => ({
  startMcpServer: (version: string) => {
    mcpStarts.push(version);
    return Promise.resolve();
  },
}));

const realArgv = process.argv;
const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;
const baselineExitListeners = process.listeners("exit");

let exitCodes: number[];
let errors: string[];
let stdout: string[];

beforeEach(() => {
  // `analyze` and `info` schedule their own `process.exit` 50 ms after
  // rendering; fake timers keep those deferred exits inside the test.
  vi.useFakeTimers();
  rendered.length = 0;
  promptAnswers.length = 0;
  promptedFor.length = 0;
  mcpStarts.length = 0;
  exitResult = Promise.resolve();
  renderThrows = null;
  exitCodes = [];
  errors = [];
  stdout = [];
  delete (globalThis as Record<string, unknown>).__zefer_stdout_content;

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
  }) as never);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  // Commander prints usage and errors straight to the streams; keep it quiet.
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(100); // drain deferred exits while the spy is live
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.argv = realArgv;
  Object.defineProperty(process, "stdin", realStdin);
  // Every import registers another `exit` listener; drop the extras.
  for (const listener of process.listeners("exit")) {
    if (!baselineExitListeners.includes(listener)) process.off("exit", listener);
  }
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).__zefer_stdout_content;
});

/** Run the CLI with the given argv tail. */
async function cli(args: string[], { isTTY = true }: { isTTY?: boolean } = {}): Promise<void> {
  process.argv = ["node", "zefer", ...args];
  Object.defineProperty(process, "stdin", { value: { isTTY }, configurable: true });
  vi.resetModules();
  await import("../index.js");
}

const lastProps = () => rendered.at(-1)!.props;

describe("MCP auto-detection", () => {
  it("starts the MCP server for an explicit `zefer mcp`", async () => {
    await cli(["mcp"]);
    expect(mcpStarts).toHaveLength(1);
    expect(mcpStarts[0]).toMatch(/^\d+\.\d+\.\d+/);
    expect(exitCodes).toEqual([0]);
    expect(rendered).toHaveLength(0);
  });

  it("starts the MCP server when launched with no arguments and a piped stdin", async () => {
    await cli([], { isTTY: false });
    expect(mcpStarts).toHaveLength(1);
  });

  it("does not start it for a bare `zefer` on a terminal", async () => {
    await cli([], { isTTY: true });
    expect(mcpStarts).toHaveLength(0);
  });

  it("does not start it when help was requested for the mcp command", async () => {
    await cli(["mcp", "--help"]);
    expect(mcpStarts).toHaveLength(0);
  });
});

describe("encrypt command", () => {
  it("passes every option through to the Ink app", async () => {
    await cli([
      "encrypt",
      "notes.txt",
      "-o",
      "out.zefer",
      "-p",
      "pass",
      "--hint",
      "two parts",
      "--note",
      "for Alice",
      "--ttl",
      "30",
      "-i",
      "800000",
      "-c",
      "gzip",
      "--max-attempts",
      "3",
      "--allowed-ips",
      " 10.0.0.1 , ::1 ,, ",
      "--verbose",
    ]);

    expect(rendered).toHaveLength(1);
    expect(lastProps()).toMatchObject({
      input: "notes.txt",
      output: "out.zefer",
      passphrase: "pass",
      hint: "two parts",
      note: "for Alice",
      ttl: 30,
      iterations: 800_000,
      compression: "gzip",
      maxAttempts: 3,
      allowedIps: ["10.0.0.1", "::1"],
      verbose: true,
      dualKey: false,
    });
  });

  it("derives the output name from the input file", async () => {
    await cli(["encrypt", "report.pdf", "-p", "pass"]);
    expect(lastProps().output).toBe("report.pdf.zefer");
  });

  it("uses encrypted.zefer for inline text and for stdin", async () => {
    await cli(["encrypt", "-t", "inline secret", "-p", "pass"]);
    expect(lastProps()).toMatchObject({ output: "encrypted.zefer", textContent: "inline secret" });

    await cli(["encrypt", "-", "-p", "pass"], { isTTY: false });
    expect(lastProps()).toMatchObject({ output: "encrypted.zefer", input: "-" });
  });

  it("defaults the option values that were not given", async () => {
    await cli(["encrypt", "-t", "x", "-p", "pass"]);
    expect(lastProps()).toMatchObject({
      ttl: 0,
      iterations: 0,
      compression: "none",
      maxAttempts: 0,
      allowedIps: [],
      verbose: false,
      secondPassphrase: undefined,
      revealKey: undefined,
    });
  });

  it("refuses to run with no input at all", async () => {
    await cli(["encrypt"]);
    expect(errors[0]).toContain("provide an input file, --text, or pipe data via stdin");
    expect(exitCodes).toContain(1);
  });

  it("accepts piped stdin as the input even without an argument", async () => {
    await cli(["encrypt", "-p", "pass"], { isTTY: false });
    expect(errors).toHaveLength(0);
    expect(lastProps().input).toBe("-");
  });

  it("prompts for the passphrase when it is not on the command line", async () => {
    promptAnswers.push("prompted-pass");
    await cli(["encrypt", "-t", "x"]);
    expect(promptedFor).toEqual(["Passphrase: "]);
    expect(lastProps().passphrase).toBe("prompted-pass");
  });

  it("aborts when the passphrase prompt comes back empty", async () => {
    await cli(["encrypt", "-t", "x"]);
    expect(errors[0]).toContain("passphrase is required");
    expect(exitCodes).toContain(1);
  });

  it("enables dual-key mode from --second without prompting", async () => {
    await cli(["encrypt", "-t", "x", "-p", "pass", "-2", "second"]);
    expect(lastProps()).toMatchObject({ dualKey: true, secondPassphrase: "second" });
    expect(promptedFor).toEqual([]);
  });

  it("prompts for the second passphrase when --dual-key is used alone", async () => {
    promptAnswers.push("second-prompted");
    await cli(["encrypt", "-t", "x", "-p", "pass", "--dual-key"]);
    expect(promptedFor).toEqual(["Second passphrase: "]);
    expect(lastProps()).toMatchObject({ dualKey: true, secondPassphrase: "second-prompted" });
  });

  it("prompts for the secret answer when only the question is given", async () => {
    promptAnswers.push("firulais");
    await cli(["encrypt", "-t", "x", "-p", "pass", "-q", "Pet name?"]);
    expect(promptedFor).toEqual(['Answer to "Pet name?": ']);
    expect(lastProps()).toMatchObject({ question: "Pet name?", questionAnswer: "firulais" });
  });

  it("does not prompt when the answer is already supplied", async () => {
    await cli(["encrypt", "-t", "x", "-p", "pass", "-q", "Pet?", "-a", "firulais"]);
    expect(promptedFor).toEqual([]);
    expect(lastProps().questionAnswer).toBe("firulais");
  });

  it("exits non-zero when the Ink app fails", async () => {
    exitResult = Promise.reject(new Error("render failed"));
    await cli(["encrypt", "-t", "x", "-p", "pass"]);
    expect(exitCodes).toContain(1);
  });
});

describe("decrypt command", () => {
  it("passes every option through to the Ink app", async () => {
    await cli([
      "decrypt",
      "secret.zefer",
      "-o",
      "out.txt",
      "-p",
      "pass",
      "-2",
      "second",
      "-a",
      "firulais",
      "--force",
      "--verbose",
    ]);
    expect(lastProps()).toMatchObject({
      input: "secret.zefer",
      output: "out.txt",
      passphrase: "pass",
      secondPassphrase: "second",
      questionAnswer: "firulais",
      force: true,
      verbose: true,
    });
  });

  it("prompts for the passphrase when it is missing", async () => {
    promptAnswers.push("prompted");
    await cli(["decrypt", "secret.zefer"]);
    expect(promptedFor).toEqual(["Passphrase: "]);
    expect(lastProps().passphrase).toBe("prompted");
  });

  it("aborts when the passphrase prompt comes back empty", async () => {
    await cli(["decrypt", "secret.zefer"]);
    expect(errors[0]).toContain("passphrase is required");
    expect(exitCodes).toContain(1);
  });

  it("flushes the staged text to stdout once Ink has exited", async () => {
    (globalThis as Record<string, unknown>).__zefer_stdout_content = "decrypted text";
    await cli(["decrypt", "secret.zefer", "-p", "pass"]);
    expect(stdout.join("")).toBe("decrypted text\n");
    expect((globalThis as Record<string, unknown>).__zefer_stdout_content).toBeUndefined();
  });

  it("does not add a second newline when the text already ends with one", async () => {
    (globalThis as Record<string, unknown>).__zefer_stdout_content = "already newline\n";
    await cli(["decrypt", "secret.zefer", "-p", "pass"]);
    expect(stdout.join("")).toBe("already newline\n");
  });

  it("writes nothing when no text was staged", async () => {
    await cli(["decrypt", "secret.zefer", "-p", "pass"]);
    expect(stdout.join("")).toBe("");
  });

  it("exits non-zero when the Ink app fails", async () => {
    exitResult = Promise.reject(new Error("boom"));
    await cli(["decrypt", "secret.zefer", "-p", "pass"]);
    expect(exitCodes).toContain(1);
  });
});

describe("keygen command", () => {
  it("passes the defaults through", async () => {
    await cli(["keygen"]);
    expect(lastProps()).toMatchObject({
      mode: "secure",
      length: 64,
      count: 1,
      excludeAmbiguous: false,
      requireAll: false,
      noRepeats: false,
      group: 0,
      sort: false,
      quiet: false,
    });
  });

  it("passes every advanced flag through, inverting --no-repeats", async () => {
    await cli([
      "keygen",
      "-m",
      "base58",
      "-l",
      "24",
      "-n",
      "5",
      "--exclude-ambiguous",
      "--exclude",
      "xyz",
      "--require-all",
      "--no-repeats",
      "--group",
      "6",
      "--sort",
      "--quiet",
    ]);
    expect(lastProps()).toMatchObject({
      mode: "base58",
      length: 24,
      count: 5,
      excludeAmbiguous: true,
      exclude: "xyz",
      requireAll: true,
      noRepeats: true,
      group: 6,
      sort: true,
      quiet: true,
    });
  });

  it("clamps the length and count into their supported ranges", async () => {
    await cli(["keygen", "-l", "99999", "-n", "0"]);
    expect(lastProps()).toMatchObject({ length: 2048, count: 1 });

    await cli(["keygen", "-l", "0", "-n", "999"]);
    expect(lastProps()).toMatchObject({ length: 1, count: 50 });
  });

  it("rejects an unknown mode", async () => {
    await cli(["keygen", "-m", "morse"]);
    expect(errors[0]).toContain('invalid mode "morse"');
    expect(exitCodes).toContain(1);
  });

  it("swallows a renderer failure instead of crashing", async () => {
    exitResult = Promise.reject(new Error("ink died"));
    await expect(cli(["keygen"])).resolves.toBeUndefined();
  });
});

describe("analyze command", () => {
  it("analyzes a password given on the command line", async () => {
    await cli(["analyze", "Tr0ub4dor&3"]);
    expect(lastProps()).toEqual({ password: "Tr0ub4dor&3" });
  });

  it("prompts for the password when it is omitted", async () => {
    promptAnswers.push("prompted-password");
    await cli(["analyze"]);
    expect(promptedFor).toEqual(["Password to analyze: "]);
    expect(lastProps()).toEqual({ password: "prompted-password" });
  });

  it("aborts when the prompt comes back empty", async () => {
    await cli(["analyze"]);
    expect(errors[0]).toContain("a password is required");
    expect(exitCodes).toContain(1);
  });

  it("exits cleanly once the report has been rendered", async () => {
    await cli(["analyze", "x"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(exitCodes).toContain(0);
  });
});

describe("info command", () => {
  it("renders the report for the given file and exits cleanly", async () => {
    await cli(["info", "secret.zefer"]);
    expect(lastProps()).toEqual({ input: "secret.zefer" });
    await vi.advanceTimersByTimeAsync(100);
    expect(exitCodes).toContain(0);
  });
});

describe("fatal errors", () => {
  it("reports an unknown command and exits non-zero", async () => {
    await cli(["not-a-command"]);
    expect(exitCodes).toContain(1);
  });

  it("reports an Error thrown out of a command by its message", async () => {
    renderThrows = new Error("terminal is on fire");
    await cli(["keygen"]);
    expect(errors.join(" ")).toContain("Fatal: terminal is on fire");
    expect(exitCodes).toContain(1);
  });

  it("reports a non-Error thrown out of a command as-is", async () => {
    renderThrows = "raw failure value";
    await cli(["keygen"]);
    expect(errors.join(" ")).toContain("Fatal: raw failure value");
    expect(exitCodes).toContain(1);
  });
});

describe("process exit hook", () => {
  /** The listener the entry point installs to flush staged stdout content. */
  async function installedHook(): Promise<NodeJS.ExitListener> {
    await cli(["keygen"]);
    const listener = process
      .listeners("exit")
      .filter((l) => !baselineExitListeners.includes(l))
      .at(-1)!;
    return listener as NodeJS.ExitListener;
  }

  it("writes staged content and appends the missing newline", async () => {
    const hook = await installedHook();
    stdout.length = 0;
    (globalThis as Record<string, unknown>).__zefer_stdout_content = "flush me";
    hook(0);
    expect(stdout.join("")).toBe("flush me\n");
  });

  it("does not append a second newline", async () => {
    const hook = await installedHook();
    stdout.length = 0;
    (globalThis as Record<string, unknown>).__zefer_stdout_content = "flush me\n";
    hook(0);
    expect(stdout.join("")).toBe("flush me\n");
  });

  it("writes nothing when no content was staged", async () => {
    const hook = await installedHook();
    stdout.length = 0;
    delete (globalThis as Record<string, unknown>).__zefer_stdout_content;
    hook(0);
    expect(stdout.join("")).toBe("");
  });
});
