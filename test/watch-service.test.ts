import { describe, expect, it, vi } from "vitest";
import type { TargetState } from "../src/core/target-state.js";
import { WatchService } from "../src/core/watch-service.js";
import type { PoltergeistConfig } from "../src/types.js";
import { createTestConfig } from "./helpers.js";

const makeMockWatchman = () => ({
  subscribe: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
});

const mockWatchmanConfigManager = {
  ensureConfigUpToDate: vi.fn(),
  suggestOptimizations: vi.fn(),
  createExclusionExpressions: vi.fn().mockReturnValue([]),
  normalizeWatchPattern: vi.fn().mockImplementation((p: string) => p),
  validateWatchPattern: vi.fn(),
};

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

const makeTargetState = (config: PoltergeistConfig, pattern: string): TargetState => {
  const target = { ...config.targets[0], watchPaths: [pattern] };
  return {
    target,
    builder: {} as any,
    watching: false,
    pendingFiles: new Set(),
  };
};

describe("WatchService", () => {
  it("resubscribes on refreshTargets", async () => {
    const config = createTestConfig();
    const watchman = makeMockWatchman();
    const service = new WatchService({
      projectRoot: "/project",
      config,
      logger: noopLogger,
      watchman,
      watchmanConfigManager: mockWatchmanConfigManager,
      onFilesChanged: vi.fn(),
    });

    const initialState = makeTargetState(config, "src/**/*.ts");
    await service.subscribeTargets(new Map([["t1", initialState]]));

    expect(watchman.subscribe).toHaveBeenCalledTimes(1);
    const firstSubName = watchman.subscribe.mock.calls[0]?.[1];

    const refreshedState = makeTargetState(config, "lib/**/*.ts");
    await service.refreshTargets(new Map([["t1", refreshedState]]));

    expect(watchman.unsubscribe).toHaveBeenCalledWith(firstSubName);
    expect(watchman.subscribe).toHaveBeenCalledTimes(2);
    const secondSubName = watchman.subscribe.mock.calls[1]?.[1];
    expect(secondSubName).toContain("lib");
  });

  it("unsubscribes only empty subscriptions for removed targets", async () => {
    const config = createTestConfig();
    const watchman = makeMockWatchman();
    const service = new WatchService({
      projectRoot: "/project",
      config,
      logger: noopLogger,
      watchman,
      watchmanConfigManager: mockWatchmanConfigManager,
      onFilesChanged: vi.fn(),
    });

    const state1 = makeTargetState(config, "src.ts");
    state1.target.name = "t1";
    const state2 = makeTargetState(config, "lib.ts");
    state2.target.name = "t2";

    await service.subscribeTargets(
      new Map([
        ["t1", state1],
        ["t2", state2],
      ]),
    );

    await service.unsubscribeTargets(["t1"]);
    const sourceName = watchman.subscribe.mock.calls[0]?.[1];
    const libraryName = watchman.subscribe.mock.calls[1]?.[1];
    expect(watchman.unsubscribe).toHaveBeenCalledWith(sourceName);
    expect(watchman.unsubscribe).not.toHaveBeenCalledWith(libraryName);

    await service.unsubscribeTargets(["t2"]);
    expect(watchman.unsubscribe).toHaveBeenCalledWith(libraryName);
  });
});

it("keeps sanitized-name collisions distinct through refresh", async () => {
  const config = createTestConfig(),
    watchman = makeMockWatchman();
  const service = new WatchService({
    projectRoot: "/project",
    config,
    logger: noopLogger,
    watchman,
    watchmanConfigManager: mockWatchmanConfigManager,
    onFilesChanged: vi.fn(),
  });
  const a = makeTargetState(config, "foo-bar/*.ts"),
    b = makeTargetState(config, "foo_bar/*.ts");
  const states = new Map([
    ["a", a],
    ["b", b],
  ]);
  await service.subscribeTargets(states);
  const first = watchman.subscribe.mock.calls.map((c) => c[1]);
  expect(new Set(first).size).toBe(2);
  await service.refreshTargets(states);
  expect(watchman.subscribe.mock.calls.slice(2).map((c) => c[1])).toEqual(first);
  expect(watchman.unsubscribe).not.toHaveBeenCalled();
});

it("routes shared subscription events only to surviving targets", async () => {
  const config = createTestConfig(),
    watchman = makeMockWatchman(),
    changed = vi.fn();
  const service = new WatchService({
    projectRoot: "/project",
    config,
    logger: noopLogger,
    watchman,
    watchmanConfigManager: mockWatchmanConfigManager,
    onFilesChanged: changed,
  });
  await service.subscribeTargets(
    new Map([
      ["a", makeTargetState(config, "src.ts")],
      ["b", makeTargetState(config, "src.ts")],
    ]),
  );
  const handler = watchman.subscribe.mock.calls[0]?.[3] as (
    files: Array<{ name: string; exists: boolean }>,
  ) => void;
  await service.unsubscribeTargets(["a"]);
  handler([{ name: "src.ts", exists: true }]);
  expect(changed).toHaveBeenCalledWith([{ name: "src.ts", exists: true }], ["b"]);
  expect(watchman.unsubscribe).not.toHaveBeenCalled();
  await service.unsubscribeTargets(["b"]);
  expect(watchman.unsubscribe).toHaveBeenCalledTimes(1);
});

it.each(["custom[dev].json", "configs/custom.json", "poltergeist.config.json"])(
  "subscribes to literal configured path %s",
  async (relative) => {
    const config = createTestConfig(),
      watchman = makeMockWatchman();
    const service = new WatchService({
      projectRoot: "/project",
      config,
      logger: noopLogger,
      watchman,
      watchmanConfigManager: mockWatchmanConfigManager,
      onFilesChanged: vi.fn(),
    });
    await service.subscribeConfig(`/project/${relative}`, vi.fn());
    expect(watchman.subscribe.mock.calls[0]?.[2]).toEqual({
      expression: ["name", relative, "wholename"],
      fields: ["name", "exists", "type"],
    });
  },
);
