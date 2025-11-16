// Factory functions for easier testing and initialization

import { BuilderFactory } from './builders/index.js';
import type {
  IBuilderFactory,
  IStateManager,
  IWatchmanClient,
  PoltergeistDependencies,
} from './interfaces.js';
import { createLogger, type Logger } from './logger.js';
import { BuildNotifier } from './notifier.js';
import { Poltergeist } from './poltergeist.js';
import { StateManager } from './state.js';
import type { PoltergeistConfig } from './types.js';
import { WatchmanClient } from './watchman.js';

/**
 * Create a Poltergeist instance with default dependencies
 */
export function createPoltergeist(
  config: PoltergeistConfig,
  projectRoot: string,
  logger?: Logger,
  configPath?: string
): Poltergeist {
  const actualLogger = logger || createLogger();
  const deps = createDefaultDependencies(projectRoot, actualLogger);
  return new Poltergeist(config, projectRoot, actualLogger, deps, configPath);
}

/**
 * Create a Poltergeist instance with custom dependencies (for testing)
 */
export function createPoltergeistWithDeps(
  config: PoltergeistConfig,
  projectRoot: string,
  deps: PoltergeistDependencies,
  logger: Logger,
  configPath?: string
): Poltergeist {
  return new Poltergeist(config, projectRoot, logger, deps, configPath);
}

/**
 * Create default dependencies
 */
export function createDefaultDependencies(
  projectRoot: string,
  logger: Logger
): PoltergeistDependencies {
  return {
    stateManager: new StateManager(projectRoot, logger),
    builderFactory: BuilderFactory,
    watchmanClient: new WatchmanClient(logger),
    notifier: undefined, // Will be created based on config
  };
}

/**
 * Create mock dependencies for testing
 */
export function createMockDependencies(): PoltergeistDependencies {
  const vi = (globalThis as { vi?: typeof import('vitest').vi }).vi;
  if (!vi) {
    throw new Error('This function requires Vitest. Import it in your test file.');
  }

  const stateManager: IStateManager = {
    initializeState: vi.fn().mockResolvedValue({}),
    readState: vi.fn().mockResolvedValue(null),
    updateState: vi.fn().mockResolvedValue(undefined),
    updateBuildStatus: vi.fn().mockResolvedValue(undefined),
    updatePostBuildResult: vi.fn().mockResolvedValue(undefined),
    removeState: vi.fn().mockResolvedValue(undefined),
    isLocked: vi.fn().mockResolvedValue(false),
    discoverStates: vi.fn().mockResolvedValue({}),
    forceUnlock: vi.fn().mockResolvedValue(undefined),
    startHeartbeat: vi.fn(),
    stopHeartbeat: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };

  const builderFactory: IBuilderFactory = {
    createBuilder: vi.fn().mockReturnValue({
      build: vi.fn().mockResolvedValue({
        status: 'success',
        targetName: 'test',
        timestamp: new Date().toISOString(),
      }),
      validate: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      getOutputInfo: vi.fn(),
      describeBuilder: vi.fn(),
    }),
  };

  const watchmanClient: IWatchmanClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    watchProject: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };

  const notifier = Object.assign(Object.create(BuildNotifier.prototype), {
    config: { enabled: false },
    notifyBuildStart: vi.fn().mockResolvedValue(undefined),
    notifyBuildComplete: vi.fn().mockResolvedValue(undefined),
    notifyBuildFailed: vi.fn().mockResolvedValue(undefined),
    notifyPoltergeistStarted: vi.fn().mockResolvedValue(undefined),
    notifyPoltergeistStopped: vi.fn().mockResolvedValue(undefined),
  }) as BuildNotifier;

  return { stateManager, builderFactory, watchmanClient, notifier };
}

/**
 * Create a test harness with mocked dependencies
 */
export interface TestHarness {
  poltergeist: Poltergeist;
  mocks: Required<PoltergeistDependencies>;
  logger: Logger;
}

export function createTestHarness(
  config: PoltergeistConfig,
  projectRoot = '/test/project'
): TestHarness {
  const logger = createLogger();
  const mocks = createMockDependencies();
  const poltergeist = createPoltergeistWithDeps(config, projectRoot, mocks, logger);

  return {
    poltergeist,
    mocks: mocks as Required<PoltergeistDependencies>,
    logger,
  };
}
