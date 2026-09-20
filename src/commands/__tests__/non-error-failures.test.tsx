/**
 * Both commands normalize whatever the core layer throws into a readable
 * status line. A thrown value that is not an `Error` must still be shown, never
 * "[object Object]". The core module is mocked, so this needs its own file.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { render } from "ink-testing-library";
import { ICON_ERR } from "../../utils/terminal.js";
import type * as ZeferModule from "../../lib/zefer.js";

vi.mock("../../lib/zefer.js", async () => {
  const actual = await vi.importActual<typeof ZeferModule>("../../lib/zefer.js");
  return {
    ...actual,
    // Both entry points reject with a bare string instead of an Error.
    encodeZefer: () => Promise.reject("core exploded while encrypting"),
    decodeZefer: () => Promise.reject("core exploded while decrypting"),
    parseFile: () => ({
      header: { iterations: 600_000, compression: "none", hint: null, note: null, mode: "text" },
      binary: true,
      binaryData: Buffer.alloc(64),
    }),
  };
});

const { EncryptApp } = await import("../encrypt.js");
const { DecryptApp } = await import("../decrypt.js");

async function errorFrame(element: React.ReactElement): Promise<string> {
  const instance = render(element);
  await vi.waitFor(
    () => {
      if (!(instance.lastFrame() ?? "").includes(ICON_ERR)) throw new Error("still running");
    },
    { timeout: 10_000, interval: 10 }
  );
  const frame = instance.lastFrame()!;
  instance.unmount();
  return frame;
}

describe("non-Error failures", () => {
  it("shows the stringified value when encryption throws a non-Error", async () => {
    const frame = await errorFrame(
      <EncryptApp
        input="-"
        output="unused.zefer"
        passphrase="passphrase"
        textContent="x"
        ttl={0}
        iterations={1_000}
        compression="none"
        maxAttempts={0}
        allowedIps={[]}
        dualKey={false}
        verbose={false}
      />
    );
    expect(frame).toContain(`${ICON_ERR} core exploded while encrypting`);
  });

  it("shows the stringified value when decryption throws a non-Error", async () => {
    const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;
    Object.defineProperty(process, "stdin", {
      value: Readable.from([Buffer.from("ZEFB3-ish bytes")]),
      configurable: true,
    });

    const frame = await errorFrame(
      <DecryptApp
        input="-"
        passphrase="passphrase"
        force={false}
        verbose={false}
      />
    );
    expect(frame).toContain(`${ICON_ERR} core exploded while decrypting`);
    Object.defineProperty(process, "stdin", realStdin);
  });
});
