import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globSync } from "glob";
import { describe, expect, it } from "vitest";
import { WatchmanConfigManager } from "../src/watchman-config.js";
import { createMockLogger } from "./helpers.js";
import { expandGlobPatterns } from "../src/utils/glob-utils.js";

it.each([
  { pattern: String.raw`src/{a\},b}.ts`, expected: [String.raw`src/a\}.ts`, "src/b.ts"] },
  {
    pattern: String.raw`src/\{literal\}/{a,b}.ts`,
    expected: [String.raw`src/\{literal\}/a.ts`, String.raw`src/\{literal\}/b.ts`],
  },
  { pattern: "src/{one,{two,}}*.ts", expected: ["src/one*.ts", "src/two*.ts", "src/*.ts"] },
])("preserves escaped braces and nested empty arms in $pattern", ({ pattern, expected }) => {
  expect(expandGlobPatterns([pattern])).toEqual(expected);
});

describe("watch pattern empty brace alternatives", () => {
  it.each(["src/{nested/,}*.ts", "src/{,nested/}*.ts"])(
    "keeps both root and nested files for %s",
    (pattern) => {
      const directory = mkdtempSync(join(tmpdir(), "polter-braces-"));
      try {
        mkdirSync(join(directory, "src", "nested"), { recursive: true });
        writeFileSync(join(directory, "src", "root.ts"), "root");
        writeFileSync(join(directory, "src", "nested", "child.ts"), "child");
        const expected = ["src/nested/child.ts", "src/root.ts"];
        expect(globSync(pattern, { cwd: directory }).toSorted()).toEqual(expected);
        expect(globSync(expandGlobPatterns([pattern]), { cwd: directory }).toSorted()).toEqual(
          expected,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

it("filters globally empty arms before Watchman normalization", () => {
  const patterns = expandGlobPatterns(["{package.json,}"]);
  expect(patterns).toEqual(["package.json"]);
  const manager = new WatchmanConfigManager("/tmp/owned-globs", createMockLogger());
  expect(patterns.map((pattern) => manager.normalizeWatchPattern(pattern))).toEqual([
    "package.json",
  ]);
});
it("does not treat an escaped final comma as an empty arm", () => {
  const directory = mkdtempSync(join(tmpdir(), "polter-escaped-braces-"));
  try {
    mkdirSync(join(directory, "src", "nested"), { recursive: true });
    for (const file of ["src/root.ts", "src/literal,one.ts", "src/nested/child.ts"])
      writeFileSync(join(directory, file), "owned");
    const pattern = String.raw`src/{nested/,literal\,}*.ts`;
    const expected = globSync(pattern, { cwd: directory }).toSorted();
    expect(expected).toEqual(["src/literal,one.ts", "src/nested/child.ts"]);
    const expanded = expandGlobPatterns([pattern]);
    expect(globSync(expanded, { cwd: directory }).toSorted()).toEqual(expected);
    const manager = new WatchmanConfigManager(directory, createMockLogger());
    const normalized = expanded.map((item) => manager.normalizeWatchPattern(item));
    expect(globSync(normalized, { cwd: directory }).toSorted()).toEqual(expected);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
