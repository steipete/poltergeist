import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { executeStaleWithWarning, executeTarget } from "../src/polter/execution.js";
import type { ExecutableTarget } from "../src/types.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "polter-execution-"));
  roots.push(root);
  return root;
}

function writeScript(root: string, name: string, source: string): void {
  writeFileSync(path.join(root, name), source, { mode: 0o755 });
}

function executableTarget(outputPath: string): ExecutableTarget {
  return {
    name: "signalled-child",
    type: "executable",
    enabled: true,
    buildCommand: "true",
    outputPath,
    watchPaths: [outputPath],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("polter child exit status", () => {
  it("keeps a normal exit code", async () => {
    const root = makeRoot();
    writeScript(root, "ok.js", "process.exit(0);\n");

    await expect(
      executeTarget(executableTarget("./ok.js"), root, [], { verbose: false }),
    ).resolves.toBe(0);
  });

  it("keeps a non-zero exit code", async () => {
    const root = makeRoot();
    writeScript(root, "fail.js", "process.exit(4);\n");

    await expect(
      executeTarget(executableTarget("./fail.js"), root, [], { verbose: false }),
    ).resolves.toBe(4);
  });

  it.skipIf(process.platform === "win32")(
    "reports a signalled executeTarget child as failure",
    async () => {
      const root = makeRoot();
      writeScript(root, "die.js", 'process.kill(process.pid, "SIGTERM");\n');

      await expect(
        executeTarget(executableTarget("./die.js"), root, [], { verbose: false }),
      ).resolves.toBe(143);
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports a signalled stale child as failure",
    async () => {
      const root = makeRoot();
      writeScript(root, "die.js", 'process.kill(process.pid, "SIGTERM");\n');

      await expect(executeStaleWithWarning("die", root, [], { verbose: false })).resolves.toBe(143);
    },
  );
});
