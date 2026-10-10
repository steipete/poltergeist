import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globSync } from "glob";
import { describe, expect, it } from "vitest";
import { expandGlobPatterns } from "../src/utils/glob-utils.js";

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
