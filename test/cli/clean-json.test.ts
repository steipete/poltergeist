import { Command } from "commander";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerProjectCommands } from "../../src/cli/commands/project.js";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "poltergeist-clean-"));
  process.env.POLTERGEIST_STATE_DIR = stateDir;
});

afterEach(() => {
  delete process.env.POLTERGEIST_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

// Both projects define a target called "app", which is what makes the two state
// files collide when the target name is used to resolve them.
const writeState = (
  fileName: string,
  projectName: string,
  projectPath: string,
  isActive = false,
) => {
  writeFileSync(
    join(stateDir, fileName),
    JSON.stringify({
      version: "1.0",
      projectPath,
      projectName,
      target: "app",
      targetType: "executable",
      configPath: join(projectPath, ".poltergeist.json"),
      process: {
        // Not a live pid, so liveness refresh resolves this to inactive.
        pid: 999999,
        hostname: "test-host",
        isActive,
        startTime: new Date(0).toISOString(),
        lastHeartbeat: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      },
    }),
  );
};

const runClean = async (args: string[]) => {
  const program = new Command();
  registerProjectCommands(program);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  await program.parseAsync(args, { from: "user" });
  const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
  logSpy.mockRestore();
  return output;
};

describe("clean --json", () => {
  it("outputs json summary and removes files", async () => {
    writeState("demo-1234abcd-app.state", "demo", "/tmp/demo");

    const output = await runClean(["clean", "--json"]);

    expect(output).toContain('"removed": 1');
    expect(output).toContain("demo-1234abcd-app.state");
    expect(readdirSync(stateDir)).toHaveLength(0);
  });

  it("removes each state file it reports, not the current project's file", async () => {
    // Two projects, both with an "app" target. Resolving a file by target name
    // through a StateManager rooted at one project makes both names collide, so
    // the wrong file gets read and removed.
    writeState("demo-1234abcd-app.state", "demo", "/tmp/demo");
    writeState("other-5678efab-app.state", "other", "/tmp/other");

    const output = await runClean(["clean", "--all", "--json"]);

    expect(output).toContain('"removed": 2');
    expect(existsSync(join(stateDir, "demo-1234abcd-app.state"))).toBe(false);
    expect(existsSync(join(stateDir, "other-5678efab-app.state"))).toBe(false);
  });

  it("treats a state file as stale when its recorded process is gone", async () => {
    // The owning process died without updating its own file, so isActive is
    // still true on disk while the pid is long gone.
    writeState("demo-1234abcd-app.state", "demo", "/tmp/demo", true);

    const output = await runClean(["clean", "--json"]);

    expect(output).toContain('"removed": 1');
    expect(existsSync(join(stateDir, "demo-1234abcd-app.state"))).toBe(false);
  });

  it("keeps cleaning when a file disappears before it is removed", async () => {
    writeState("aaa-1234abcd-app.state", "aaa", "/tmp/aaa");
    writeState("zzz-5678efab-app.state", "zzz", "/tmp/zzz");

    // Delete the first file after clean has read and announced it, but before
    // it is unlinked, which is the concurrent-cleanup race.
    const program = new Command();
    registerProjectCommands(program);
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const line = String(args[0] ?? "");
      if (line.includes("Removing:") && line.includes("aaa-1234abcd-app.state")) {
        rmSync(join(stateDir, "aaa-1234abcd-app.state"), { force: true });
      }
    });
    await program.parseAsync(["clean", "--all", "--json"], { from: "user" });
    logSpy.mockRestore();

    // The second file must still be cleaned rather than the pass aborting.
    expect(existsSync(join(stateDir, "zzz-5678efab-app.state"))).toBe(false);
    expect(readdirSync(stateDir)).toHaveLength(0);
  });

  it("reports each file under its own project name", async () => {
    writeState("demo-1234abcd-app.state", "demo", "/tmp/demo");
    writeState("other-5678efab-app.state", "other", "/tmp/other");

    const output = await runClean(["clean", "--all", "--json", "--dry-run"]);

    expect(output).toContain("demo");
    expect(output).toContain("other");
    // Nothing is removed in a dry run.
    expect(readdirSync(stateDir)).toHaveLength(2);
  });
});
