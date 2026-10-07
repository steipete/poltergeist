import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { SimpleLogger } from "../src/logger.js";
import { PostBuildRunner } from "../src/post-build/post-build-runner.js";
import { StateManager } from "../src/state.js";

it.skipIf(process.platform !== "win32").each(["hook", "formatter"])(
  "stops the Windows shell and its active %s child before resolving",
  async (mode) => {
    const dir = mkdtempSync(join(tmpdir(), "poltergeist-windows-stop-"));
    const prior = process.env.POLTERGEIST_STATE_DIR;
    process.env.POLTERGEIST_STATE_DIR = join(dir, "states");
    const pidFile = join(dir, "pid");
    writeFileSync(
      join(dir, "hold.cjs"),
      "require('node:fs').writeFileSync('pid',String(process.pid));setInterval(()=>{},1000)",
    );
    writeFileSync(join(dir, "obsolete.cjs"), "require('node:fs').writeFileSync('obsolete','ran')");
    const command = (file: string) => `"${process.execPath}" "${join(dir, file)}"`;
    const logger = new SimpleLogger(undefined, "error");
    const state = new StateManager(dir, logger);
    const runner = new PostBuildRunner({
      projectRoot: dir,
      targetName: "app",
      logger,
      stateManager: state,
      hooks: [
        {
          name: "active",
          command: mode === "hook" ? command("hold.cjs") : "echo raw",
          formatter: mode === "formatter" ? command("hold.cjs") : undefined,
        },
        { name: "obsolete", command: command("obsolete.cjs") },
      ],
    });
    let pid: number | undefined;
    const alive = () => {
      if (!pid) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      await state.initializeState({
        name: "app",
        type: "executable",
        buildCommand: "echo build",
        outputPath: "app",
        watchPaths: [],
      });
      runner.onBuildResult("success");
      const deadline = Date.now() + 5000;
      while (!existsSync(pidFile)) {
        if (Date.now() >= deadline) throw new Error("Child did not start");
        await sleep(20);
      }
      pid = Number(readFileSync(pidFile, "utf8"));
      await runner.stop();
      expect(alive()).toBe(false);
      expect(existsSync(join(dir, "obsolete"))).toBe(false);
      expect((await state.readState("app"))?.postBuildResults?.active?.completedAt).toBeDefined();
    } finally {
      if (alive()) process.kill(pid!, "SIGKILL");
      await runner.stop();
      await state.cleanup();
      if (prior === undefined) delete process.env.POLTERGEIST_STATE_DIR;
      else process.env.POLTERGEIST_STATE_DIR = prior;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15000,
);
