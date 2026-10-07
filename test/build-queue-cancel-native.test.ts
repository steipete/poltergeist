import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { it } from "vitest";
import { IntelligentBuildQueue } from "../src/build-queue.js";
import { PriorityEngine } from "../src/priority-engine.js";
import { ExecutableBuilder } from "../src/builders/executable-builder.js";
import { StateManager } from "../src/state.js";
import { SimpleLogger } from "../src/logger.js";
import type { BuildSchedulingConfig, ExecutableTarget } from "../src/types.js";

it.skipIf(process.platform === "win32").each(["target", "all"] as const)(
  "cancels deferred builds with %s cancellation",
  async (mode) => {
    const dir = mkdtempSync(join(tmpdir(), "poltergeist-queue-dedup-"));
    const priorStateDir = process.env.POLTERGEIST_STATE_DIR;
    process.env.POLTERGEIST_STATE_DIR = join(dir, "states");
    const logger = new SimpleLogger(undefined, "error");
    const state = new StateManager(dir, logger);
    const config: BuildSchedulingConfig = {
      parallelization: 1,
      prioritization: {
        enabled: true,
        focusDetectionWindow: 300000,
        priorityDecayTime: 1800000,
        buildTimeoutMultiplier: 2,
      },
    };
    const queue = new IntelligentBuildQueue(config, logger, new PriorityEngine(config, logger));
    const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
    writeFileSync(
      join(dir, "blocker.cjs"),
      `const fs=require('node:fs');fs.appendFileSync('blocker-count','x');fs.writeFileSync('ready','ready');const t=setInterval(()=>{if(fs.existsSync('release')){clearInterval(t);fs.writeFileSync('blocker-output','ok');}},10);setTimeout(()=>process.exit(2),5000).unref();`,
    );
    writeFileSync(
      join(dir, "app.cjs"),
      `const fs=require('node:fs');fs.appendFileSync('count','x');fs.writeFileSync('app-output','ok');`,
    );
    const blocker: ExecutableTarget = {
      name: "blocker",
      type: "executable",
      buildCommand: `exec ${quote(process.execPath)} blocker.cjs`,
      outputPath: "blocker-output",
      watchPaths: ["blocker.ts"],
    };
    const app: ExecutableTarget = {
      name: "app",
      type: "executable",
      buildCommand: `exec ${quote(process.execPath)} app.cjs`,
      outputPath: "app-output",
      watchPaths: ["*.ts"],
    };
    const builders = [
      new ExecutableBuilder(blocker, dir, logger, state),
      new ExecutableBuilder(app, dir, logger, state),
    ];
    queue.registerTarget(blocker, builders[0]);
    queue.registerTarget(app, builders[1]);
    async function wait(p: () => boolean) {
      const deadline = Date.now() + 5000;
      while (!p()) {
        assert.ok(Date.now() < deadline, "native queue fixture timed out");
        await sleep(10);
      }
    }
    try {
      await queue.queueTargetBuild(blocker);
      await wait(() => existsSync(join(dir, "ready")));
      await queue.onFileChanged(["one.ts"], [blocker]);
      if (mode === "target") {
        await queue.onFileChanged(["app-only.ts"], [app]);
        assert.equal(queue.cancelPendingBuilds("blocker"), 0);
        assert.deepEqual(
          queue.getQueueStatus().pending.map((entry) => entry.target),
          ["app"],
        );
      } else queue.clearQueue();
      writeFileSync(join(dir, "release"), "release");
      await wait(
        () =>
          queue.getQueueStatus().running.length === 0 &&
          queue.getQueueStatus().pending.length === 0,
      );
      const builds = readFileSync(join(dir, "blocker-count"), "utf8").length;
      console.log(JSON.stringify({ builds, stats: queue.getQueueStatus().stats }));
      assert.equal(builds, 1);
      if (mode === "target") assert.equal(readFileSync(join(dir, "count"), "utf8"), "x");
      else assert.equal(existsSync(join(dir, "count")), false);
    } finally {
      writeFileSync(join(dir, "release"), "release");
      queue.clearQueue();
      for (const b of builders) b.stop();
      await sleep(50);
      await state.cleanup();
      rmSync(dir, { recursive: true, force: true });
      if (priorStateDir === undefined) delete process.env.POLTERGEIST_STATE_DIR;
      else process.env.POLTERGEIST_STATE_DIR = priorStateDir;
    }
  },
);
