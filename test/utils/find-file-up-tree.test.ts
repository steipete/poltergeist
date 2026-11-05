import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemUtils } from "../../src/utils/filesystem.js";

describe("findFileUpTree", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds a config in a parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "polter-up-"));
    roots.push(root);
    writeFileSync(join(root, "poltergeist.config.json"), "{}");
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });

    expect(FileSystemUtils.findFileUpTree("poltergeist.config.json", nested)).toBe(
      join(root, "poltergeist.config.json"),
    );
  });

  it("returns null when a UNC walk has no config", () => {
    if (process.platform !== "win32") {
      return;
    }

    expect(
      FileSystemUtils.findFileUpTree("poltergeist.config.json", "\\\\server\\share\\nested"),
    ).toBeNull();
  }, 2000);
});
