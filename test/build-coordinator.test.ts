import { describe, expect, it, vi } from "vitest";
import { BuildCoordinator } from "../src/core/build-coordinator.js";
import { Poltergeist } from "../src/poltergeist.js";
import type { TargetState } from "../src/core/target-state.js";
import type { BuildSchedulingConfig, Target } from "../src/types.js";
import {
  createMockDependencies,
  createMockLogger,
  createMockStateManager,
  createTestConfig,
} from "./helpers.js";

const baseScheduling: BuildSchedulingConfig = {
  parallelization: 2,
  prioritization: {
    enabled: false,
    focusDetectionWindow: 0,
    priorityDecayTime: 0,
    buildTimeoutMultiplier: 1,
  },
} as const;

function createSuccessState(target: Target): TargetState {
  const builder = {
    build: vi.fn().mockResolvedValue({
      status: "success",
      targetName: target.name,
      timestamp: new Date().toISOString(),
    }),
    validate: vi.fn(),
    stop: vi.fn(),
    getOutputInfo: vi.fn(),
    describeBuilder: vi.fn().mockReturnValue("mock"),
  };

  return {
    target,
    builder,
    pendingFiles: new Set(["src/index.ts"]),
    watching: true,
    runner: {
      onBuildSuccess: vi.fn().mockResolvedValue(undefined),
      onBuildFailure: vi.fn(),
      stop: vi.fn(),
    },
    postBuildRunner: {
      onBuildResult: vi.fn(),
      stop: vi.fn(),
    },
  };
}

describe("BuildCoordinator", () => {
  it.each(["success", "failure", "throw"] as const)(
    "notifies each distinct recipient once for %s, retaining repeated-result deduplication",
    async (outcome) => {
      const target = createTestConfig().targets[0];
      const state = createSuccessState(target);
      if (outcome === "throw") {
        vi.mocked(state.builder.build).mockRejectedValue(new Error("compile failed"));
      } else if (outcome === "failure") {
        vi.mocked(state.builder.build).mockResolvedValue({
          status: "failure",
          targetName: target.name,
          timestamp: new Date().toISOString(),
          error: "compile failed",
        });
      }
      // Count actual deliveries independently of Vitest's call history.
      const deliveries = [0, 0];
      const notifiers = deliveries.map((_, index) => ({
        ...createMockDependencies().notifier,
        notifyBuildComplete: async () => {
          deliveries[index]++;
        },
        notifyBuildFailed: async () => {
          deliveries[index]++;
        },
      }));
      const coordinator = new BuildCoordinator({
        projectRoot: "/project",
        logger: createMockLogger(),
        stateManager: createMockStateManager(),
        notifier: notifiers[0],
        depsNotifier: notifiers[1],
        fallbackNotifier: notifiers[0],
      });
      const states = new Map([[target.name, state]]);

      await coordinator.buildTarget(target.name, states);
      expect(deliveries).toEqual([1, 1]);
      await coordinator.buildTarget(target.name, states);
      expect(deliveries).toEqual([1, 1]);
    },
  );

  it("does not deliver notifications to another Poltergeist instance", async () => {
    const config = createTestConfig();
    const target = config.targets[0];
    const otherDeps = createMockDependencies();
    new Poltergeist(config, "/other-project", createMockLogger(), otherDeps);
    const notifier = createMockDependencies().notifier;
    const coordinator = new BuildCoordinator({
      projectRoot: "/project",
      logger: createMockLogger(),
      stateManager: createMockStateManager(),
      notifier,
      depsNotifier: notifier,
    });

    await coordinator.buildTarget(
      target.name,
      new Map([[target.name, createSuccessState(target)]]),
    );

    expect(notifier.notifyBuildComplete).toHaveBeenCalledTimes(1);
    expect(otherDeps.notifier.notifyBuildComplete).not.toHaveBeenCalled();
  });

  it("invokes runner and notifier on successful build", async () => {
    const config = createTestConfig();
    const target = config.targets[0];
    if (!target) {
      throw new Error("Test config missing target");
    }
    const state = createSuccessState(target);
    const notifier: Pick<
      Parameters<typeof BuildCoordinator>[0]["notifier"],
      "notifyBuildComplete" | "notifyBuildFailed"
    > = {
      notifyBuildComplete: vi.fn(),
      notifyBuildFailed: vi.fn(),
    };

    const coordinator = new BuildCoordinator({
      projectRoot: "/project",
      logger: createMockLogger(),
      stateManager: createMockStateManager(),
      notifier,
      buildSchedulingConfig: baseScheduling,
    });

    await coordinator.buildTarget(target.name, new Map([[target.name, state]]));

    expect(state.runner?.onBuildSuccess).toHaveBeenCalledTimes(1);
    expect(notifier.notifyBuildComplete).toHaveBeenCalledTimes(1);
  });

  it("records failures when build throws", async () => {
    const config = createTestConfig();
    const target = config.targets[0];
    if (!target) {
      throw new Error("Test config missing target");
    }
    const builderError = new Error("boom");

    const state: TargetState = {
      target,
      builder: {
        build: vi.fn().mockRejectedValue(builderError),
        validate: vi.fn(),
        stop: vi.fn(),
        getOutputInfo: vi.fn(),
        describeBuilder: vi.fn().mockReturnValue("mock"),
      },
      pendingFiles: new Set(["src/index.ts"]),
      watching: true,
    };

    const stateManager = createMockStateManager();
    const notifier: Pick<Parameters<typeof BuildCoordinator>[0]["notifier"], "notifyBuildFailed"> =
      {
        notifyBuildFailed: vi.fn(),
      };

    const coordinator = new BuildCoordinator({
      projectRoot: "/project",
      logger: createMockLogger(),
      stateManager,
      notifier,
      buildSchedulingConfig: baseScheduling,
    });

    await coordinator.buildTarget(target.name, new Map([[target.name, state]]));

    expect(stateManager.updateBuildStatus).toHaveBeenCalledTimes(1);
    expect(notifier.notifyBuildFailed).toHaveBeenCalledTimes(1);
  });
});
