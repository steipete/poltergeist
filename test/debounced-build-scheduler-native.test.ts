import { setTimeout as sleep } from "node:timers/promises";
import { expect, it } from "vitest";
import { DebouncedBuildScheduler } from "../src/core/debounced-build-scheduler.js";
import type { TargetState } from "../src/core/target-state.js";
import { ExecutableBuilder } from "../src/builders/executable-builder.js";
import { StateManager } from "../src/state.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SimpleLogger } from "../src/logger.js";
import type { ExecutableTarget } from "../src/types.js";

it("retains a later pending debounce when an active build completes", async () => {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const target: ExecutableTarget = {
    name: "app",
    type: "executable",
    buildCommand: "echo build",
    outputPath: "app",
    watchPaths: [],
    settlingDelay: 10,
  };
  const dir = mkdtempSync(join(tmpdir(), "poltergeist-debounce-"));
  const priorStateDir = process.env.POLTERGEIST_STATE_DIR;
  process.env.POLTERGEIST_STATE_DIR = join(dir, "state");
  const logger = new SimpleLogger(undefined, "error");
  const stateManager = new StateManager(dir, logger);
  const state: TargetState = {
    target,
    builder: new ExecutableBuilder(target, dir, logger, stateManager),
    watching: true,
    pendingFiles: new Set(),
  };
  const states = new Map([["app", state]]);
  const calls: string[][] = [];
  const scheduler = new DebouncedBuildScheduler({
    defaultDelayMs: 10,
    buildTarget: async (_name, files) => {
      calls.push(files);
      state.pendingFiles.clear();
      started();
      await held;
    },
  });
  let newestTimer: NodeJS.Timeout | undefined;
  try {
    scheduler.schedule(["first.ts"], ["app"], states);
    await began;
    target.settlingDelay = 2000;
    scheduler.schedule(["second.ts"], ["app"], states);
    newestTimer = state.buildTimer;
    release();
    await sleep(20);
    expect(state.buildTimer).toBe(newestTimer);
    expect(calls).toEqual([["first.ts"]]);
  } finally {
    release();
    clearTimeout(newestTimer);
    clearTimeout(state.buildTimer);
    await stateManager.cleanup();
    if (priorStateDir === undefined) delete process.env.POLTERGEIST_STATE_DIR;
    else process.env.POLTERGEIST_STATE_DIR = priorStateDir;
    rmSync(dir, { recursive: true, force: true });
  }
});
