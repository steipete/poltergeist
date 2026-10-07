import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetLifecycleManager } from "../src/core/target-lifecycle.js";
import { PostBuildRunner } from "../src/post-build/post-build-runner.js";
import { Poltergeist } from "../src/poltergeist.js";
import type { ExecutableTarget, LibraryTarget, PoltergeistConfig } from "../src/types.js";
import { ConfigurationManager } from "../src/utils/config-manager.js";
import { detectConfigChanges } from "../src/utils/config-diff.js";
import { createMockDependencies, createMockLogger } from "./helpers.js";

const target = (name: string): ExecutableTarget => ({
  name,
  type: "executable",
  enabled: true,
  buildCommand: "echo ok",
  outputPath: "dist/app",
  watchPaths: [],
  postBuild: [{ name: "hook", command: "echo done" }],
});

afterEach(() => vi.restoreAllMocks());

describe("shutdown cleanup after hook retirement failures", () => {
  it("does not apply a configuration load that completes during shutdown", async () => {
    const deps = createMockDependencies();
    const config: PoltergeistConfig = {
      version: "1.0",
      targets: [],
      notifications: { enabled: false },
    };
    let release!: (value: PoltergeistConfig) => void;
    const pending = new Promise<PoltergeistConfig>((resolve) => {
      release = resolve;
    });
    const load = vi.spyOn(ConfigurationManager, "loadConfigFromPath").mockReturnValue(pending);
    const app = new Poltergeist(
      config,
      "/project",
      createMockLogger(),
      deps,
      "/project/custom.json",
    );
    await app.start();
    const callback = vi
      .mocked(deps.watchmanClient!.subscribe)
      .mock.calls.find((call) => call[1] === "poltergeist_config")![3];
    const reloading = callback([{ name: "custom.json", exists: true }]);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    const stopping = app.stop();
    release({ ...config, targets: [target("too-late")] });
    await Promise.all([reloading, stopping]);
    expect(deps.builderFactory.createBuilder).not.toHaveBeenCalled();
    expect(deps.watchmanClient!.disconnect).toHaveBeenCalled();
    expect(await app.getStatus()).not.toHaveProperty("too-late");
    callback([{ name: "custom.json", exists: true }]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("cancels hooks and builders while the executable is still stopping", async () => {
    const deps = createMockDependencies();
    const manager = new TargetLifecycleManager({
      projectRoot: "/project",
      logger: createMockLogger(),
      stateManager: deps.stateManager,
      builderFactory: deps.builderFactory,
    });
    await manager.initTargets([target("first")]);
    const state = manager.getTargetStates().get("first")!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(state.runner!, "stop").mockReturnValue(gate);
    const hooks = vi.spyOn(state.postBuildRunner!, "stop");
    const stopping = manager.stopTargets();
    try {
      await vi.waitFor(() => expect(hooks).toHaveBeenCalled());
      expect(state.builder.stop).toHaveBeenCalled();
    } finally {
      release();
      await stopping;
    }
  });

  it("retires a target added while the first hook is stopping", async () => {
    const deps = createMockDependencies();
    const manager = new TargetLifecycleManager({
      projectRoot: "/project",
      logger: createMockLogger(),
      stateManager: deps.stateManager,
      builderFactory: deps.builderFactory,
    });
    await manager.initTargets([target("first")]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = manager.getTargetStates().get("first")!;
    const stoppingHook = vi.spyOn(first.postBuildRunner!, "stop").mockReturnValue(gate);
    const stopping = manager.stopTargets();
    await vi.waitFor(() => expect(stoppingHook).toHaveBeenCalled());
    await manager.addTargets([target("second")]);
    const second = manager.getTargetStates().get("second")!;
    const secondStop = vi.spyOn(second.postBuildRunner!, "stop");
    release();
    await stopping;
    expect(first.builder.stop).toHaveBeenCalled();
    expect(secondStop).toHaveBeenCalled();
    expect(second.builder.stop).toHaveBeenCalled();
    expect(manager.getTargetStates().size).toBe(0);
  });

  for (const failure of [
    new Error("Post-build runner first did not stop within 2 seconds"),
    Object.assign(new Error("kill EPERM"), { code: "EPERM" }),
  ]) {
    it("retires the old builder but aborts replacement when hook retirement fails", async () => {
      const deps = createMockDependencies();
      const manager = new TargetLifecycleManager({
        projectRoot: "/project",
        logger: createMockLogger(),
        stateManager: deps.stateManager,
        builderFactory: deps.builderFactory,
      });
      const original = target("first");
      await manager.initTargets([original]);
      const previous = manager.getTargetStates().get("first")!;
      vi.spyOn(previous.postBuildRunner!, "stop").mockRejectedValue(failure);
      const replacement: LibraryTarget = { ...original, type: "library", libraryType: "static" };
      const error = await manager
        .updateTargets([{ name: "first", newTarget: replacement }])
        .catch((caught: unknown) => caught);
      expect(previous.builder.stop).toHaveBeenCalled();
      expect(manager.getTargetStates().get("first")).toBe(previous);
      expect(previous.target).toBe(original);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toContain(failure);
    });

    it.each([undefined, "first"])("lifecycle cleanup continues for target %s", async (name) => {
      const deps = createMockDependencies();
      const manager = new TargetLifecycleManager({
        projectRoot: "/project",
        logger: createMockLogger(),
        stateManager: deps.stateManager,
        builderFactory: deps.builderFactory,
      });
      await manager.initTargets([target("first"), target("second")]);
      const first = manager.getTargetStates().get("first")!;
      const second = manager.getTargetStates().get("second")!;
      vi.spyOn(first.postBuildRunner!, "stop").mockRejectedValue(failure);
      const secondStop = vi.spyOn(second.postBuildRunner!, "stop");

      const result = manager.stopTargets(name).catch((error: unknown) => error);
      const error = await result;
      expect(first.builder.stop).toHaveBeenCalled();
      expect(manager.getTargetStates().has("first")).toBe(false);
      if (name) {
        expect(deps.stateManager.removeState).toHaveBeenCalledWith("first");
        expect(secondStop).not.toHaveBeenCalled();
      } else {
        expect(secondStop).toHaveBeenCalled();
        expect(second.builder.stop).toHaveBeenCalled();
        expect(deps.stateManager.cleanup).toHaveBeenCalled();
        expect(manager.getTargetStates().size).toBe(0);
      }
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toContain(failure);
    });

    it.each(["all", "single", "remove"])(
      "public %s cleanup continues after retirement fails",
      async (mode) => {
        const deps = createMockDependencies();
        const logger = createMockLogger();
        const config: PoltergeistConfig = {
          version: "1.0",
          targets: [target("first"), target("second")],
          notifications: { enabled: false },
        };
        const poltergeist = new Poltergeist(config, "/project", logger, deps);
        await poltergeist.start();
        const hooks = vi
          .spyOn(PostBuildRunner.prototype, "stop")
          .mockResolvedValue(undefined)
          .mockRejectedValueOnce(failure);
        const removed = { ...config, targets: [config.targets[1]!] };
        const error = await (
          mode === "remove"
            ? poltergeist.applyConfigChanges(removed, detectConfigChanges(config, removed))
            : poltergeist.stop(mode === "single" ? "first" : undefined)
        ).catch((caught: unknown) => caught);
        const firstBuilder = deps.builderFactory.createBuilder;
        const created = vi.mocked(firstBuilder).mock.results;
        expect(created[0]?.value.stop).toHaveBeenCalled();
        if (mode === "all") {
          expect(hooks).toHaveBeenCalledTimes(2);
          expect(created[1]?.value.stop).toHaveBeenCalled();
          expect(deps.watchmanClient?.disconnect).toHaveBeenCalled();
          expect(deps.stateManager.cleanup).toHaveBeenCalled();
        } else {
          expect(deps.stateManager.removeState).toHaveBeenCalledWith("first");
        }
        if (mode === "remove") {
          expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("Failed to remove target first"),
          );
        } else {
          expect(error).toBeInstanceOf(AggregateError);
          expect((error as AggregateError).errors).toContain(failure);
          expect(logger.info).not.toHaveBeenCalledWith(
            "👻 [Poltergeist] Poltergeist is now at rest",
          );
        }
        await poltergeist.stop();
      },
    );
  }
});
