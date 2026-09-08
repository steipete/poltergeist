import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseBuilder } from "../src/builders/base-builder.js";
import { targetForBuild } from "../src/core/build-context.js";
import { BuildCoordinator } from "../src/core/build-coordinator.js";
import { TargetLifecycleManager } from "../src/core/target-lifecycle.js";
import type { TargetState } from "../src/core/target-state.js";
import type { BuildNotifier } from "../src/notifier.js";
import { WatchService } from "../src/core/watch-service.js";
import { Poltergeist } from "../src/poltergeist.js";
import { ExecutableRunner } from "../src/runners/executable-runner.js";
import type { StateManager } from "../src/state.js";
import type { ExecutableTarget, PoltergeistConfig, Target } from "../src/types.js";
import { detectConfigChanges } from "../src/utils/config-diff.js";
import {
  createMockBuilder,
  createMockDependencies,
  createMockLogger,
  createMockStateManager,
} from "./helpers.js";

vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  spawn: vi.fn(),
}));
const { spawn } = await import("child_process");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const target = (generation: string): ExecutableTarget => ({
  name: "app",
  type: "executable",
  enabled: true,
  buildCommand: generation,
  outputPath: `out-${generation}`,
  watchPaths: [`${generation}/**/*.ts`],
  autoRun: {
    enabled: true,
    command: `run-${generation}`,
    args: [generation],
    env: { GENERATION: generation },
    restartDelayMs: 100,
  },
});

class RecordingBuilder extends BaseBuilder<ExecutableTarget> {
  gate = Promise.resolve();
  stages: string[] = [];
  async validate() {}
  getOutputInfo(): string | undefined {
    return undefined;
  }
  protected getGitHash() {
    return "test";
  }
  protected async executeBuild() {
    this.stages.push(this.target.buildCommand);
    await this.gate;
  }
  protected async postBuild() {
    this.stages.push(this.target.outputPath);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("configuration reload lifecycle", () => {
  it("keeps the existing target alive if its replacement cannot be created", async () => {
    const deps = createMockDependencies();
    const builder = createMockBuilder("app");
    const factory = vi
      .fn()
      .mockReturnValueOnce(builder)
      .mockImplementationOnce(() => {
        throw new Error("unsupported target");
      });
    const manager = new TargetLifecycleManager({
      projectRoot: "/project",
      logger: createMockLogger(),
      stateManager: deps.stateManager,
      builderFactory: { createBuilder: factory },
    });
    await manager.initTargets([target("A")]);
    const state = manager.getTargetStates().get("app")!;
    const stop = vi.spyOn(state.runner!, "stop");
    const library: Target = {
      name: "app",
      type: "library",
      enabled: true,
      buildCommand: "build",
      outputPath: "lib",
      libraryType: "static",
      watchPaths: [],
    };
    await expect(manager.updateTargets([{ name: "app", newTarget: library }])).rejects.toThrow(
      "unsupported target",
    );
    expect(builder.stop).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(state.target.type).toBe("executable");
  });

  it.each([false, true])(
    "recreates a builder when its target type changes (reverse=%s)",
    async (reverse) => {
      const executable = target("A");
      const library: Target = {
        name: "app",
        type: "library",
        enabled: true,
        buildCommand: "library build",
        outputPath: "out-lib",
        libraryType: "static",
        watchPaths: ["src/**/*.ts"],
      };
      const [before, after] = reverse ? [library, executable] : [executable, library];
      const deps = createMockDependencies();
      const factory = vi.fn(() => createMockBuilder("app"));
      const manager = new TargetLifecycleManager({
        projectRoot: "/project",
        logger: createMockLogger(),
        stateManager: deps.stateManager,
        builderFactory: { createBuilder: factory },
      });
      await manager.initTargets([before]);
      const previousBuilder = manager.getTargetStates().get("app")!.builder;
      await manager.updateTargets([{ name: "app", newTarget: after }]);
      expect(previousBuilder.stop).toHaveBeenCalledOnce();
      expect(factory).toHaveBeenCalledTimes(2);
      expect(manager.getTargetStates().get("app")!.builder).not.toBe(previousBuilder);
      expect(manager.getTargetStates().get("app")!.target).toBe(after);
      expect(Boolean(manager.getTargetStates().get("app")!.runner)).toBe(
        after.type === "executable",
      );
    },
  );

  it("reports the output produced by an active build after the configured path changes", async () => {
    class OutputBuilder extends RecordingBuilder {
      getOutputInfo() {
        return this.target.outputPath;
      }
    }
    const a = target("A");
    const b = target("B");
    const logger = createMockLogger();
    const stateManager = Object.assign(createMockStateManager(), {
      updateAppInfo: vi.fn().mockResolvedValue(undefined),
    });
    const builder = new OutputBuilder(
      a,
      "/project",
      logger,
      stateManager as unknown as StateManager,
    );
    const gate = deferred();
    builder.gate = gate.promise;
    const state: TargetState = { target: a, builder, watching: true, pendingFiles: new Set() };
    const notifyBuildComplete = vi.fn();
    const coordinator = new BuildCoordinator({
      projectRoot: "/project",
      logger,
      stateManager,
      notifier: { notifyBuildComplete } as unknown as BuildNotifier,
    });
    const build = coordinator.buildTarget("app", new Map([["app", state]]));
    builder.updateTarget(b);
    state.target = b;
    gate.resolve();
    await build;
    expect(notifyBuildComplete).toHaveBeenCalledWith(
      "app Built",
      expect.stringContaining("out-A"),
      undefined,
    );
  });

  it("keeps all active build stages and results on their producing target", async () => {
    const a = target("A");
    const b = target("B");
    const builder = new RecordingBuilder(
      a,
      "/project",
      createMockLogger(),
      createMockStateManager() as StateManager,
    );
    const gate = deferred();
    builder.gate = gate.promise;
    const first = builder.build([]);
    const second = builder.build([]);
    builder.updateTarget(b);
    const third = builder.build([]);
    gate.resolve();
    const results = await Promise.all([first, second]);
    expect(targetForBuild(await third, a)).toBe(b);
    expect(builder.stages).toEqual(["A", "A", "B", "out-A", "out-A", "out-B"]);
    for (const result of results) expect(targetForBuild(result, b)).toBe(a);
    const next = await builder.build([]);
    expect(targetForBuild(next, a)).toBe(b);
    expect(builder.stages.slice(-2)).toEqual(["B", "out-B"]);
    expect(JSON.stringify(next)).not.toContain("GENERATION");
  });

  it("updates the retained builder through the production reload application", async () => {
    const a = target("A");
    const b = target("B");
    const config: PoltergeistConfig = { version: "1.0", targets: [a] };
    const deps = createMockDependencies();
    const builder = new RecordingBuilder(
      a,
      "/project",
      createMockLogger(),
      deps.stateManager as StateManager,
    );
    deps.builderFactory.createBuilder = vi.fn().mockReturnValue(builder);
    const app = new Poltergeist(config, "/project", createMockLogger(), deps);
    await app.applyConfigChanges(config, {
      ...detectConfigChanges(config, config),
      targetsAdded: [a],
    });
    const next = { ...config, targets: [b] };
    await app.applyConfigChanges(next, detectConfigChanges(config, next));
    await builder.build([]);
    expect(builder.stages).toEqual(["B", "out-B"]);
  });

  it("does not deliver an old builder's completion to its replacement runner", async () => {
    const a = target("A");
    const b = target("B");
    const logger = createMockLogger();
    const stateManager = createMockStateManager();
    const builder = new RecordingBuilder(a, "/project", logger, stateManager as StateManager);
    const gate = deferred();
    builder.gate = gate.promise;
    const state: TargetState = { target: a, builder, watching: true, pendingFiles: new Set() };
    const states = new Map([["app", state]]);
    const coordinator = new BuildCoordinator({ projectRoot: "/project", logger, stateManager });
    const build = coordinator.buildTarget("app", states);
    state.target = b;
    state.builder = createMockBuilder("app");
    state.runner = new ExecutableRunner(b, { projectRoot: "/project", logger });
    const launch = vi.spyOn(state.runner, "onBuildSuccess").mockResolvedValue(undefined);
    gate.resolve();
    await build;
    expect(launch).not.toHaveBeenCalled();
    expect(state.lastBuild).toBeUndefined();
  });

  it("ignores queued completions owned by a retired builder", async () => {
    const a = target("A");
    const b = target("B");
    const config: PoltergeistConfig = { version: "1.0", targets: [b] };
    const app = new Poltergeist(config, "/project", createMockLogger(), createMockDependencies());
    await app.applyConfigChanges(config, {
      ...detectConfigChanges(config, config),
      targetsAdded: [b],
    });
    const internal = app as unknown as {
      targetStates: Map<string, TargetState>;
      handleQueuedBuildResult: (
        result: { status: string; timestamp: string; targetName: string },
        request: { target: Target; builder: BaseBuilder },
      ) => Promise<void>;
    };
    const state = internal.targetStates.get("app")!;
    const launch = vi.spyOn(state.runner!, "onBuildSuccess").mockResolvedValue(undefined);
    await internal.handleQueuedBuildResult(
      { status: "success", timestamp: "test", targetName: "app" },
      { target: a, builder: createMockBuilder("app") },
    );
    expect(launch).not.toHaveBeenCalled();
    expect(state.lastBuild).toBeUndefined();
  });

  it("serializes load, diff, apply and commit and recovers after a failed reload", async () => {
    const config: PoltergeistConfig = { version: "1.0", targets: [target("A")] };
    const b = { ...config, targets: [target("B")] };
    const c = { ...config, targets: [target("C")] };
    const app = new Poltergeist(
      config,
      "/project",
      createMockLogger(),
      createMockDependencies(),
      "/project/poltergeist.config.json",
    );
    const internal = app as unknown as {
      configReload: { reloadConfig: ReturnType<typeof vi.fn> };
      handleConfigChange: (files: { name: string; exists: boolean }[]) => Promise<void>;
    };
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ config: b, changes: detectConfigChanges(config, b) })
      .mockRejectedValueOnce(new Error("invalid config"))
      .mockResolvedValueOnce({ config: c, changes: detectConfigChanges(b, c) });
    internal.configReload = { reloadConfig: loader };
    const gate = deferred();
    vi.spyOn(app, "applyConfigChanges")
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    const files = [{ name: "poltergeist.config.json", exists: true }];
    const first = internal.handleConfigChange(files);
    const second = internal.handleConfigChange(files);
    await vi.waitFor(() => expect(app.applyConfigChanges).toHaveBeenCalledTimes(1));
    expect(loader).toHaveBeenCalledTimes(1);
    gate.resolve();
    await Promise.all([first, second]);
    await internal.handleConfigChange(files);
    expect(loader.mock.calls.map(([current]) => current)).toEqual([config, b, b]);
  });

  it("retains the config subscription through repeated target refreshes and removals", async () => {
    const deps = createMockDependencies();
    const config: PoltergeistConfig = { version: "1.0", targets: [] };
    const service = new WatchService({
      projectRoot: "/project",
      config,
      logger: createMockLogger(),
      watchman: deps.watchmanClient,
      watchmanConfigManager: deps.watchmanConfigManager!,
      onFilesChanged: vi.fn(),
    });
    await service.subscribeConfig("/project/poltergeist.config.json", vi.fn());
    await service.refreshTargets(new Map(), config);
    await service.unsubscribeTargets(["app"]);
    await service.refreshTargets(new Map(), config);
    expect(deps.watchmanClient?.unsubscribe).not.toHaveBeenCalledWith("poltergeist_config");
    await service.stop();
    expect(deps.watchmanClient?.unsubscribe).toHaveBeenCalledWith("poltergeist_config");
  });
});

describe("artifact-owned restarts", () => {
  function setup() {
    vi.useFakeTimers();
    const children: Array<
      EventEmitter & {
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
      }
    > = [];
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        killed: false,
        kill: vi.fn(),
      });
      child.kill.mockImplementation((signal: NodeJS.Signals) => {
        child.killed = true;
        child.signalCode = signal;
        child.emit("exit", null, signal);
        return true;
      });
      children.push(child);
      return child as unknown as ChildProcess;
    });
    const runner = new ExecutableRunner(target("A"), {
      projectRoot: "/project",
      logger: createMockLogger(),
    });
    return { runner, children };
  }

  it("launches the newest successful artifact while a failed newer config cannot redirect it", async () => {
    const { runner } = setup();
    await runner.onBuildSuccess(target("A"));
    await runner.onBuildSuccess(target("A"));
    await runner.updateTarget(target("B"));
    await runner.onBuildSuccess(target("B"));
    await runner.updateTarget(target("C"));
    runner.onBuildFailure({ status: "failure", timestamp: "test", error: "failed C" });
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual(["run-A", "run-B"]);
    expect(spawn).toHaveBeenLastCalledWith(
      "run-B",
      ["B"],
      expect.objectContaining({ env: expect.objectContaining({ GENERATION: "B" }) }),
    );
    await runner.stop();
  });

  it("keeps a successful target through asynchronous child shutdown", async () => {
    const { runner, children } = setup();
    await runner.onBuildSuccess(target("A"));
    children[0].kill.mockReturnValue(true);
    await runner.onBuildSuccess(target("A"));
    await vi.advanceTimersByTimeAsync(100);
    await runner.updateTarget(target("B"));
    await runner.onBuildSuccess(target("B"));
    children[0].emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual(["run-A", "run-B"]);
    await runner.stop();
  });

  it("uses the latest successful target's restart delay", async () => {
    const { runner } = setup();
    await runner.onBuildSuccess(target("A"));
    await runner.onBuildSuccess(target("A"));
    const b = target("B");
    b.autoRun!.restartDelayMs = 1000;
    await runner.updateTarget(b);
    await runner.onBuildSuccess(b);
    await vi.advanceTimersByTimeAsync(100);
    expect(spawn).toHaveBeenCalledTimes(1);
    const c = target("C");
    c.autoRun!.restartDelayMs = 0;
    await runner.updateTarget(c);
    await runner.onBuildSuccess(c);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual(["run-A", "run-C"]);
    await runner.stop();
  });

  it("starts a fresh delay for a newer artifact even when the delay value is unchanged", async () => {
    const { runner } = setup();
    await runner.onBuildSuccess(target("A"));
    await runner.onBuildSuccess(target("A"));
    await vi.advanceTimersByTimeAsync(90);
    await runner.updateTarget(target("B"));
    await runner.onBuildSuccess(target("B"));
    await vi.advanceTimersByTimeAsync(10);
    expect(spawn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90);
    expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual(["run-A", "run-B"]);
    await runner.stop();
  });

  it("preserves the existing coalesced deadline for repeated builds of the same configuration", async () => {
    const { runner } = setup();
    const a = target("A");
    await runner.onBuildSuccess(a);
    await runner.onBuildSuccess(a);
    await vi.advanceTimersByTimeAsync(90);
    await runner.onBuildSuccess(a);
    await vi.advanceTimersByTimeAsync(10);
    expect(spawn).toHaveBeenCalledTimes(2);
    await runner.stop();
  });

  it("waits through timer-sized chunks for a long restart delay", async () => {
    const { runner, children } = setup();
    await runner.onBuildSuccess(target("A"));
    const b = target("B");
    b.autoRun!.restartDelayMs = 2_147_483_648;
    await runner.updateTarget(b);
    await runner.onBuildSuccess(b);
    await vi.advanceTimersByTimeAsync(1);
    expect(children[0].kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_147_483_646);
    expect(children[0].kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual(["run-A", "run-B"]);
    await runner.stop();
  });

  it("does not strand a build success arriving as a restart finishes", async () => {
    const { runner } = setup();
    const createChild = vi.mocked(spawn).getMockImplementation()!;
    const c = target("C");
    c.autoRun!.restartDelayMs = 0;
    vi.mocked(spawn).mockImplementation((command, args, options) => {
      const child = createChild(command, args, options);
      if (command === "run-B")
        queueMicrotask(() => {
          void runner.onBuildSuccess(c);
        });
      return child;
    });
    await runner.onBuildSuccess(target("A"));
    await runner.updateTarget(target("B"));
    await runner.onBuildSuccess(target("B"));
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual([
      "run-A",
      "run-B",
      "run-C",
    ]);
    await runner.stop();
  });

  it("cancels queued launches when disabled and can subsequently be re-enabled", async () => {
    const { runner } = setup();
    await runner.onBuildSuccess(target("A"));
    await runner.onBuildSuccess(target("A"));
    await runner.updateTarget({ ...target("B"), autoRun: { enabled: false } });
    await vi.advanceTimersByTimeAsync(200);
    expect(spawn).toHaveBeenCalledTimes(1);
    await runner.updateTarget(target("C"));
    await runner.onBuildSuccess(target("C"));
    expect(vi.mocked(spawn).mock.calls.map(([command]) => command)).toEqual(["run-A", "run-C"]);
    await runner.stop();
  });

  it("escalates shutdown after a child ignores the first signal", async () => {
    const { runner, children } = setup();
    await runner.onBuildSuccess(target("A"));
    children[0].kill.mockImplementation((signal: NodeJS.Signals) => {
      children[0].killed = true;
      if (signal === "SIGKILL") children[0].emit("exit", null, signal);
      return true;
    });
    const stopped = runner.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await stopped;
    expect(children[0].kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  });
});
