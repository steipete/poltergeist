import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDirname,
  getFilename,
  isCompiledBinary,
  isMainModule,
  normalizePolterArgv,
} from "../../src/utils/paths.js";

describe.sequential("paths utilities", () => {
  const originalArgv = process.argv.slice();
  const originalExecDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");

  afterEach(() => {
    process.argv = originalArgv.slice();
    if (originalExecDescriptor) {
      Object.defineProperty(process, "execPath", originalExecDescriptor);
    } else {
      delete (process as any).execPath;
    }
    vi.resetModules();
  });

  it("returns current dirname and filename values", () => {
    expect(getDirname()).toContain("src/utils");
    expect(getFilename()).toContain("src/utils/paths");
  });

  it("infers main module from argv comparison when require is unavailable", () => {
    delete (globalThis as any).require;
    delete (globalThis as any).module;
    process.argv = ["/usr/bin/node", getFilename()];

    expect(isMainModule()).toBe(true);
  });

  it("returns false when argv target differs from current file", () => {
    process.argv = ["/usr/bin/node", "/tmp/other-script.js"];

    expect(isMainModule()).toBe(false);
  });

  it("detects Bun compiled argv markers", () => {
    process.argv = ["/tmp/$bunfs/poltergeist", ...originalArgv.slice(1)];

    expect(isCompiledBinary()).toBe(true);
  });

  it("preserves current Bun standalone polter argv", () => {
    const argv = ["/tmp/polter", "/$bunfs/root/polter", "demo"];

    expect(normalizePolterArgv(argv)).toBe(argv);
  });

  it("adds the missing polter script path for older Bun argv", () => {
    expect(normalizePolterArgv(["/tmp/polter", "demo"])).toEqual([
      "/tmp/polter",
      "/polter",
      "demo",
    ]);
  });

  it("does not mistake an older Bun target named polter for a script path", () => {
    expect(normalizePolterArgv(["/tmp/polter", "polter"])).toEqual([
      "/tmp/polter",
      "/polter",
      "polter",
    ]);
  });

  it("treats non-bun execPath as compiled binary", () => {
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Poltergeist.app/Contents/MacOS/poltergeist",
      configurable: true,
      writable: true,
    });

    expect(isCompiledBinary()).toBe(true);
  });

  it("treats non-bun execPath as compiled binary", () => {
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Poltergeist.app/Contents/MacOS/poltergeist",
      configurable: true,
      writable: true,
    });

    expect(isCompiledBinary()).toBe(true);
  });
});
