import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createBuilder } from "../src/builders/index.js";
import { TargetLifecycleManager } from "../src/core/target-lifecycle.js";
import { SimpleLogger } from "../src/logger.js";
import { StateManager } from "../src/state.js";
import type { ExecutableTarget, PostBuildCommandConfig } from "../src/types.js";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

describe.skipIf(process.platform === "win32")("native hook configuration reload", () => {
  it.each(["change", "add", "remove", "unchanged"] as const)(
    "%s hooks on an existing executable",
    async (mode) => {
      const dir = mkdtempSync(join(tmpdir(), "poltergeist-hook-reload-"));
      const prior = process.env.POLTERGEIST_STATE_DIR;
      process.env.POLTERGEIST_STATE_DIR = join(dir, "states");
      writeFileSync(join(dir, "old.cjs"), "require('node:fs').writeFileSync('old-hook','old')");
      writeFileSync(join(dir, "new.cjs"), "require('node:fs').writeFileSync('new-hook','new')");
      const hook = (name: string): PostBuildCommandConfig => ({
        name: "check",
        command: `exec ${quote(process.execPath)} ${name}.cjs`,
      });
      const target: ExecutableTarget = {
        name: "app",
        type: "executable",
        buildCommand: "echo build",
        outputPath: "app",
        watchPaths: [],
        postBuild: mode === "add" ? [] : [hook("old")],
      };
      const logger = new SimpleLogger(undefined, "error");
      const state = new StateManager(dir, logger);
      const lifecycle = new TargetLifecycleManager({
        projectRoot: dir,
        logger,
        stateManager: state,
        builderFactory: { createBuilder: (t, root, log) => createBuilder(t, root, log, state) },
      });
      try {
        await lifecycle.initTargets([target]);
        const previous = lifecycle.getTargetStates().get("app")?.postBuildRunner;
        const updated: ExecutableTarget = {
          ...target,
          outputPath: "updated-app",
          postBuild: mode === "remove" ? [] : [hook(mode === "unchanged" ? "old" : "new")],
        };
        await lifecycle.updateTargets([{ name: "app", newTarget: updated }]);
        const runner = lifecycle.getTargetStates().get("app")?.postBuildRunner;
        if (mode === "remove") {
          expect(runner).toBeUndefined();
          return;
        }
        if (mode === "unchanged") expect(runner).toBe(previous);
        else expect(runner).not.toBe(previous);
        expect(runner).toBeDefined();
        runner?.onBuildResult("success");
        const deadline = Date.now() + 3000;
        while (!(await state.readState("app"))?.postBuildResults?.check?.completedAt) {
          if (Date.now() >= deadline) throw new Error("Native hook reload timed out");
          await sleep(10);
        }
        expect(existsSync(join(dir, "new-hook"))).toBe(mode !== "unchanged");
        expect(existsSync(join(dir, "old-hook"))).toBe(mode === "unchanged");
      } finally {
        await lifecycle.stopTargets();
        if (prior === undefined) delete process.env.POLTERGEIST_STATE_DIR;
        else process.env.POLTERGEIST_STATE_DIR = prior;
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
