import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { SimpleLogger } from "../src/logger.js";
import { PostBuildRunner } from "../src/post-build/post-build-runner.js";
import { StateManager } from "../src/state.js";
import type { ExecutableTarget, PostBuildCommandConfig } from "../src/types.js";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Native hook fixture timed out");
    await sleep(10);
  }
}

describe.skipIf(process.platform === "win32")("native post-build cancellation", () => {
  it("does not run queued or newly submitted hooks after stop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "poltergeist-hook-stop-"));
    const priorStateDir = process.env.POLTERGEIST_STATE_DIR;
    process.env.POLTERGEIST_STATE_DIR = join(dir, "states");
    const ready = join(dir, "ready");
    const marker = join(dir, "queued");
    writeFileSync(
      join(dir, "first.cjs"),
      `require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`,
    );
    writeFileSync(
      join(dir, "second.cjs"),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'queued ran')`,
    );
    const hooks: PostBuildCommandConfig[] = [
      {
        name: "first",
        command: `exec ${quote(process.execPath)} ${quote(join(dir, "first.cjs"))}`,
      },
      {
        name: "second",
        command: `exec ${quote(process.execPath)} ${quote(join(dir, "second.cjs"))}`,
      },
    ];
    const target: ExecutableTarget = {
      name: "app",
      type: "executable",
      buildCommand: "echo build",
      outputPath: "app",
      watchPaths: [],
      postBuild: hooks,
    };
    const logger = new SimpleLogger(undefined, "error");
    const stateManager = new StateManager(dir, logger);
    const runner = new PostBuildRunner({
      targetName: "app",
      hooks,
      projectRoot: dir,
      stateManager,
      logger,
    });
    try {
      await stateManager.initializeState(target);
      runner.onBuildResult("success");
      await waitFor(() => existsSync(ready));
      await runner.stop();
      await waitFor(async () =>
        Boolean((await stateManager.readState("app"))?.postBuildResults?.first?.completedAt),
      );
      runner.onBuildResult("success");
      await sleep(200);
      expect(existsSync(marker)).toBe(false);
      expect((await stateManager.readState("app"))?.postBuildResults?.first?.status).toBe(
        "failure",
      );
    } finally {
      await runner.stop();
      await stateManager.cleanup();
      if (priorStateDir === undefined) delete process.env.POLTERGEIST_STATE_DIR;
      else process.env.POLTERGEIST_STATE_DIR = priorStateDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("terminates an active formatter when stopped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "poltergeist-formatter-stop-"));
    const priorStateDir = process.env.POLTERGEIST_STATE_DIR;
    process.env.POLTERGEIST_STATE_DIR = join(dir, "states");
    const ready = join(dir, "formatter-pid");
    writeFileSync(
      join(dir, "formatter.cjs"),
      `require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`,
    );
    const hooks: PostBuildCommandConfig[] = [
      {
        name: "check",
        command: "printf raw",
        formatter: `exec ${quote(process.execPath)} ${quote(join(dir, "formatter.cjs"))}`,
      },
    ];
    const target: ExecutableTarget = {
      name: "app",
      type: "executable",
      buildCommand: "echo build",
      outputPath: "app",
      watchPaths: [],
      postBuild: hooks,
    };
    const logger = new SimpleLogger(undefined, "error");
    const stateManager = new StateManager(dir, logger);
    const runner = new PostBuildRunner({
      targetName: "app",
      hooks,
      projectRoot: dir,
      stateManager,
      logger,
    });
    let pid: number | undefined;
    const alive = () => {
      try {
        process.kill(pid!, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      await stateManager.initializeState(target);
      runner.onBuildResult("success");
      await waitFor(() => existsSync(ready));
      pid = Number(readFileSync(ready, "utf8"));
      await runner.stop();
      await waitFor(() => !alive());
      await waitFor(async () =>
        Boolean((await stateManager.readState("app"))?.postBuildResults?.check?.completedAt),
      );
    } finally {
      if (pid && alive()) process.kill(pid, "SIGKILL");
      await runner.stop();
      await stateManager.cleanup();
      if (priorStateDir === undefined) delete process.env.POLTERGEIST_STATE_DIR;
      else process.env.POLTERGEIST_STATE_DIR = priorStateDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
