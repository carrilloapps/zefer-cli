/**
 * MCP error normalization: when a handler throws something that is not an
 * `Error`, the server must still answer with a readable tool error rather than
 * "[object Object]". `node:fs` is mocked for the whole module graph, so this
 * lives in its own file.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PassThrough } from "node:stream";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof fs>("node:fs");
  return {
    ...actual,
    readFileSync: () => {
      throw "EIO from a patched filesystem"; // a bare string, not an Error
    },
  };
});

const { startMcpServer } = await import("../server.js");

const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;

afterEach(() => {
  Object.defineProperty(process, "stdin", realStdin);
});

describe("startMcpServer — non-Error handler failure", () => {
  it("stringifies the thrown value into the tool error", async () => {
    const input = new PassThrough();
    Object.defineProperty(process, "stdin", { value: input, configurable: true });

    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    const finished = startMcpServer("test");
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "zefer_inspect",
          // An existing path, so the handler gets past its own existence check.
          arguments: { inputPath: path.resolve("package.json") },
        },
      })}\n`
    );
    input.end();
    await finished;
    spy.mockRestore();

    const res = JSON.parse(written.join("").trim());
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toBe("Internal error: EIO from a patched filesystem");
  });
});
