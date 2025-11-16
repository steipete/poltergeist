// Test helpers for Poltergeist tests

import { EventEmitter } from 'events';
import { vi } from 'vitest';
import type { BaseBuilder } from '../src/builders/index.js';
import type {
  IBuilderFactory,
  IStateManager,
  IWatchmanClient,
  IWatchmanConfigManager,
  PoltergeistDependencies,
} from '../src/interfaces.js';
import type { Logger } from '../src/logger.js';
import type { BuildNotifier } from '../src/notifier.js';
import type { BuildStatus, PoltergeistConfig, Target } from '../src/types.js';

/**
 * Create a mock logger
 */
export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
}

/**
 * Create a mock Watchman client with EventEmitter capabilities
 */
export function createMockWatchmanClient(): IWatchmanClient & EventEmitter {
  const client = new EventEmitter() as IWatchmanClient & EventEmitter;
  client.connect = vi.fn().mockResolvedValue(undefined);
  client.disconnect = vi.fn().mockResolvedValue(undefined);
  client.watchProject = vi.fn().mockResolvedValue(undefined);
  client.subscribe = vi.fn().mockResolvedValue(undefined);
  client.unsubscribe = vi.fn().mockResolvedValue(undefined);
  client.isConnected = vi.fn().mockReturnValue(true);
  return client;
}

/**
 * Create a mock Watchman config manager
 */
export function createMockWatchmanConfigManager(): IWatchmanConfigManager {
  return {
    ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
    suggestOptimizations: vi.fn().mockResolvedValue([]),
    createExclusionExpressions: vi.fn().mockReturnValue([]),
    normalizeWatchPattern: vi.fn().mockImplementation((pattern: string) => pattern),
    validateWatchPattern: vi.fn().mockReturnValue(undefined),
  };
}

/**
 * Create a mock state manager
 */
export function createMockStateManager(): IStateManager {
  return {
    initializeState: vi.fn().mockResolvedValue({
      version: '1.0',
      projectPath: '/test/project',
      projectName: 'test',
      target: 'test-target',
      targetType: 'executable',
      configPath: '/test/project/.poltergeist.json',
      process: {
        pid: process.pid,
        hostname: 'test-host',
        isActive: true,
        startTime: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      },
    }),
    readState: vi.fn().mockResolvedValue(null),
    updateState: vi.fn().mockResolvedValue(undefined),
    updateBuildStatus: vi.fn().mockResolvedValue(undefined),
    forceUnlock: vi.fn().mockResolvedValue(false),
    removeState: vi.fn().mockResolvedValue(undefined),
    isLocked: vi.fn().mockResolvedValue(false),
    discoverStates: vi.fn().mockResolvedValue({}),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock builder with configurable delay
 */
export function createMockBuilder(
  targetName: string,
  options: {
    delay?: number;
    shouldFail?: boolean;
    buildDuration?: number;
  } = {}
): BaseBuilder {
  const { delay = 50, shouldFail = false, buildDuration = 100 } = options;

  const mockBuilder = {
    build: vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                status: shouldFail ? 'failure' : 'success',
                targetName,
                timestamp: new Date().toISOString(),
                duration: buildDuration,
                ...(shouldFail && { error: 'Mock build failure' }),
              } as BuildStatus),
            delay
          )
        )
    ),
    validate: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    getOutputInfo: vi.fn().mockReturnValue(`Built ${targetName}`),
    getProjectRoot: vi.fn().mockReturnValue('/test/project'),
    // Add required properties from BaseBuilder
    target: { name: targetName } as Target,
    projectRoot: '/test/project',
    logger: createMockLogger(),
    stateManager: {} as IStateManager,
    currentProcess: undefined,
  };

  // Set the prototype to BaseBuilder
  Object.setPrototypeOf(mockBuilder, Object.create(Object.getPrototypeOf({} as BaseBuilder)));

  return mockBuilder as BaseBuilder;
}

/**
 * Create a mock builder that completes immediately (no delay)
 */
export function createInstantMockBuilder(targetName: string, shouldFail = false): BaseBuilder {
  return createMockBuilder(targetName, { delay: 0, shouldFail });
}

/**
 * Create a mock builder that can be manually controlled
 */
export function createControllableMockBuilder(targetName: string): {
  builder: BaseBuilder;
  complete: (result?: Partial<BuildStatus>) => void;
  fail: (error?: string) => void;
} {
  let resolver: (value: BuildStatus) => void;

  const mockBuilder = {
    build: vi.fn().mockImplementation(
      () =>
        new Promise<BuildStatus>((resolve) => {
          resolver = resolve;
        })
    ),
    validate: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    getOutputInfo: vi.fn().mockReturnValue(`Built ${targetName}`),
    getProjectRoot: vi.fn().mockReturnValue('/test/project'),
    target: { name: targetName } as Target,
    projectRoot: '/test/project',
    logger: createMockLogger(),
    stateManager: {} as IStateManager,
    currentProcess: undefined,
  };

  Object.setPrototypeOf(mockBuilder, Object.create(Object.getPrototypeOf({} as BaseBuilder)));

  return {
    builder: mockBuilder as BaseBuilder,
    complete: (result = {}) => {
      if (resolver) {
        resolver({
          status: 'success',
          targetName,
          timestamp: new Date().toISOString(),
          duration: 100,
          ...result,
        } as BuildStatus);
      }
    },
    fail: (error = 'Mock build failure') => {
      if (resolver) {
        resolver({
          status: 'failure',
          targetName,
          timestamp: new Date().toISOString(),
          duration: 100,
          error,
        } as BuildStatus);
      }
    },
  };
}

/**
 * Create a mock builder factory that tracks created builders
 */
export interface MockBuilderFactory extends IBuilderFactory {
  builders: Map<string, BaseBuilder>;
}

export function createMockBuilderFactory(): MockBuilderFactory {
  const builders = new Map<string, BaseBuilder>();

  return {
    builders,
    createBuilder: vi.fn().mockImplementation((target: Target) => {
      const builder = createMockBuilder(target.name);
      builders.set(target.name, builder);
      return builder;
    }),
  };
}

/**
 * Create a minimal test configuration
 */
export function createTestConfig(overrides?: Partial<PoltergeistConfig>): PoltergeistConfig {
  return {
    version: '1.0',
    projectType: 'node',
    targets: [
      {
        name: 'test-target',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist',
        watchPaths: ['src/**/*.ts'],
        settlingDelay: 100,
      },
    ],
    watchman: {
      useDefaultExclusions: true,
      excludeDirs: [],
      projectType: 'node',
      maxFileEvents: 10000,
      recrawlThreshold: 5,
      settlingDelay: 1000,
      rules: [],
    },
    performance: {
      mode: 'balanced',
      reportInterval: 300,
    },
    ...overrides,
  };
}

/**
 * Create a complete set of mock dependencies
 */
export function createMockDependencies(): PoltergeistDependencies {
  return {
    watchmanClient: createMockWatchmanClient(),
    stateManager: createMockStateManager(),
    builderFactory: createMockBuilderFactory(),
    watchmanConfigManager: createMockWatchmanConfigManager(),
    notifier: {
      config: { enabled: false },
      notifyBuildStart: vi.fn().mockResolvedValue(undefined),
      notifyBuildComplete: vi.fn().mockResolvedValue(undefined),
      notifyBuildFailed: vi.fn().mockResolvedValue(undefined),
      notifyPoltergeistStarted: vi.fn().mockResolvedValue(undefined),
      notifyPoltergeistStopped: vi.fn().mockResolvedValue(undefined),
    } as BuildNotifier,
  };
}

/**
 * Simulate file changes through Watchman
 */
export function simulateFileChange(
  watchmanClient: IWatchmanClient & EventEmitter,
  files: string[],
  subscriptionIndex = 0
): void {
  const subscribeCalls = vi.mocked(watchmanClient.subscribe).mock.calls;
  const callback = subscribeCalls[subscriptionIndex]?.[3];

  if (!callback) {
    throw new Error(`No subscription callback found at index ${subscriptionIndex}`);
  }

  const fileChanges = files.map((name) => ({
    name,
    exists: true,
    type: 'f' as const,
  }));

  callback(fileChanges);
}

/**
 * Wait for all pending timers and promises
 */
export async function waitForAsync(ms?: number, options?: { drainAll?: boolean }): Promise<void> {
  const drainAll = options?.drainAll ?? true;
  if (typeof ms === 'number') {
    await vi.advanceTimersByTimeAsync(ms);
  }
  if (drainAll) {
    await vi.runAllTimersAsync();
  }
  await Promise.resolve();
}

/**
 * Create a test harness with all dependencies set up
 */
export interface TestHarness {
  config: PoltergeistConfig;
  logger: Logger;
  deps: PoltergeistDependencies;
  watchmanClient: IWatchmanClient & EventEmitter;
  stateManager: IStateManager;
  builderFactory: MockBuilderFactory;
}

export function createTestHarness(configOverrides?: Partial<PoltergeistConfig>): TestHarness {
  const config = createTestConfig(configOverrides);
  const logger = createMockLogger();
  const deps = createMockDependencies();

  return {
    config,
    logger,
    deps,
    watchmanClient: deps.watchmanClient as IWatchmanClient & EventEmitter,
    stateManager: deps.stateManager,
    builderFactory: deps.builderFactory as MockBuilderFactory,
  };
}

/**
 * Assert that a builder was called with expected files
 */
export function expectBuilderCalledWith(
  builder: BaseBuilder,
  expectedFiles: string[],
  callIndex = 0
): void {
  expect(builder.build).toHaveBeenCalledTimes(callIndex + 1);
  const call = vi.mocked(builder.build).mock.calls[callIndex];
  expect(call?.[0]).toEqual(expectedFiles);
}

/**
 * Assert build status
 */
export function expectBuildStatus(
  buildStatus: BuildStatus,
  expectedStatus: 'success' | 'failure' | 'building',
  targetName?: string
): void {
  expect(buildStatus.status).toBe(expectedStatus);
  if (targetName) {
    expect(buildStatus.targetName).toBe(targetName);
  }
}
