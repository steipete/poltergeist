import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("synchronous atomic writes in native ESM", () => {
  it("writes and replaces binary data from a real Node ESM consumer", () => {
    const dir = mkdtempSync(join(tmpdir(), "poltergeist-atomic-esm-"));
    try {
      const file = join(dir, "nested/state.json");
      const moduleURL = pathToFileURL(resolve("src/utils/atomic-write.ts")).href;
      execFileSync(process.execPath, [
        "--input-type=module",
        "-e",
        `
        import { writeFileAtomicSync } from ${JSON.stringify(moduleURL)};
        const file = ${JSON.stringify(file)};
        writeFileAtomicSync(file, "old", {mode: 0o600});
        writeFileAtomicSync(file, Buffer.from([0, 1, 255]), {mode: 0o600});
      `,
      ]);
      expect([...readFileSync(file)]).toEqual([0, 1, 255]);
      expect(readdirSync(join(dir, "nested"))).toEqual(["state.json"]);
      if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
