import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { prepareLaunchInfo } from "../../src/utils/launch.js";

it("runs a non-executable CommonJS output with Node and keeps arguments intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "poltergeist-cjs-"));
  try {
    writeFileSync(
      join(dir, "main.cjs"),
      "console.log(require('node:path').basename(__filename),process.argv[2])",
      { mode: 0o644 },
    );
    const launch = prepareLaunchInfo(
      {
        name: "app",
        type: "executable",
        outputPath: "main.cjs",
        buildCommand: "echo build",
        watchPaths: [],
      },
      dir,
      ["arg with spaces"],
    );
    const output = execFileSync(launch.command, launch.commandArgs, { encoding: "utf8" });
    expect(output.trim()).toBe("main.cjs arg with spaces");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
