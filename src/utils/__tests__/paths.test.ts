/**
 * Path safety — the adversarial cases a hostile `.zefer` file can carry in its
 * encrypted `fileName`, plus normalization of caller-chosen destinations.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { sanitizeOutputName, sanitizeExplicitPath } from "../paths.js";

const CWD = process.cwd();

describe("sanitizeOutputName — accepted names", () => {
  it("resolves a plain name inside the working directory", () => {
    expect(sanitizeOutputName("report.pdf")).toBe(path.join(CWD, "report.pdf"));
  });

  it("keeps only the final segment of a POSIX path", () => {
    expect(sanitizeOutputName("some/deep/dir/report.pdf")).toBe(path.join(CWD, "report.pdf"));
  });

  it("keeps only the final segment of a Windows path, on any platform", () => {
    expect(sanitizeOutputName("some\\deep\\dir\\report.pdf")).toBe(path.join(CWD, "report.pdf"));
  });

  it("collapses repeated and mixed separators", () => {
    expect(sanitizeOutputName("a//b\\\\c/report.pdf")).toBe(path.join(CWD, "report.pdf"));
  });

  it("strips embedded NUL bytes instead of truncating the name", () => {
    expect(sanitizeOutputName("re\0port.pdf")).toBe(path.join(CWD, "report.pdf"));
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeOutputName("  report.pdf  ")).toBe(path.join(CWD, "report.pdf"));
  });

  it("keeps dotfiles and names that merely start with dots", () => {
    expect(sanitizeOutputName(".bashrc")).toBe(path.join(CWD, ".bashrc"));
    expect(sanitizeOutputName("...")).toBe(path.join(CWD, "..."));
  });
});

describe("sanitizeOutputName — traversal is defused, not obeyed", () => {
  it.each([
    ["POSIX zip-slip", "../../../.ssh/authorized_keys", "authorized_keys"],
    ["Windows zip-slip", "..\\..\\..\\evil.exe", "evil.exe"],
    ["an absolute POSIX path", "/etc/passwd", "passwd"],
    ["an absolute Windows path", "C:\\Windows\\System32\\evil.dll", "evil.dll"],
    ["a UNC share", "\\\\server\\share\\evil.bin", "evil.bin"],
    ["traversal hidden behind NUL bytes", "..\0/..\0/evil", "evil"],
  ])("%s lands inside the working directory as %s", (_label, hostile, expected) => {
    const resolved = sanitizeOutputName(hostile);
    expect(resolved).toBe(path.join(CWD, expected));
    expect(path.dirname(resolved)).toBe(CWD);
  });
});

describe("sanitizeOutputName — rejected names", () => {
  it.each([
    ["a bare parent reference", ".."],
    ["a bare current-directory reference", "."],
    ["a trailing parent segment", "downloads/.."],
    ["a trailing current-directory segment", "downloads/."],
    ["an empty name", ""],
    ["a whitespace-only name", "   "],
    ["a name that is only NUL bytes", "\0\0"],
    ["a name that is only separators", "///"],
    ["a POSIX root path", "/"],
    ["a Windows drive-relative name", "C:"],
    ["a drive-relative name behind a directory", "downloads/D:"],
  ])("rejects %s", (_label, name) => {
    expect(() => sanitizeOutputName(name)).toThrow(/Unsafe file name in \.zefer metadata/);
  });
});

describe("sanitizeExplicitPath", () => {
  it("resolves a relative path against the working directory", () => {
    expect(sanitizeExplicitPath("out/file.bin")).toBe(path.resolve(CWD, "out/file.bin"));
  });

  it("leaves an absolute path absolute", () => {
    const absolute = path.resolve(CWD, "..", "elsewhere.bin");
    expect(sanitizeExplicitPath(absolute)).toBe(absolute);
  });

  it("allows a deliberate traversal — the caller owns this destination", () => {
    expect(sanitizeExplicitPath("../sibling.bin")).toBe(path.resolve(CWD, "../sibling.bin"));
  });

  it("strips NUL bytes rather than letting them truncate the path", () => {
    expect(sanitizeExplicitPath("out\0/file.bin")).toBe(path.resolve(CWD, "out/file.bin"));
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeExplicitPath("  file.bin \n")).toBe(path.resolve(CWD, "file.bin"));
  });

  it.each(["", "   ", "\0", " \0 "])("rejects the empty path %j", (raw) => {
    expect(() => sanitizeExplicitPath(raw)).toThrow(/Invalid path/);
  });
});
