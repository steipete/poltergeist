// Factory functions for easier testing and initialization
import { Poltergeist } from './poltergeist.js';
import { PoltergeistConfig } from './types.js';
import { Logger, createLogger } from './logger.js';
import { StateManager } from './state.js';
import { BuilderFactory } from './builders/index.js';
// import { BuildNotifier } from './notifier.js';
import { WatchmanClient } from './watchman.js';
import { PoltergeistDependencies } from './interfaces.js';

/**
 * Create a Poltergeist instance with default dependencies
 */
export function createPoltergeist(
  config: PoltergeistConfig,
  projectRoot: string,
  logger?: Logger
): Poltergeist {
  const actualLogger = logger || createLogger();
  const deps = createDefaultDependencies(projectRoot, actualLogger);
  return new Poltergeist(config, projectRoot, actualLogger, deps);
}

/**
 * Create a Poltergeist instance with custom dependencies (for testing)
 */
export function createPoltergeistWithDeps(
  config: PoltergeistConfig,
  projectRoot: string,
  deps: PoltergeistDependencies,
  logger: Logger
): Poltergeist {
  return new Poltergeist(config, projectRoot, logger, deps);
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
  const vi = (globalThis as any).vi;
  if (!vi) {
    throw new Error('This function requires Vitest. Import it in your test file.');
  }
  
  return {
    stateManager: {
      initializeState: vi.fn().mockResolvedValue({}),
      readState: vi.fn().mockResolvedValue(null),
      updateState: vi.fn().mockResolvedValue(undefined),
      updateBuildStatus: vi.fn().mockResolvedValue(undefined),
      removeState: vi.fn().mockResolvedValue(undefined),
      isLocked: vi.fn().mockResolvedValue(false),
      discoverStates: vi.fn().mockResolvedValue({}),
      startHeartbeat: vi.fn(),
      stopHeartbeat: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(undefined),
    },
    builderFactory: {
      createBuilder: vi.fn().mockReturnValue({
        build: vi.fn().mockResolvedValue({
          status: 'success',
          targetName: 'test',
          timestamp: new Date().toISOString(),
        }),
        validate: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        getOutputInfo: vi.fn(),
      }),
    },
    watchmanClient: {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      watchProject: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    },
    notifier: {
      notify: vi.fn().mockResolvedValue(undefined),
      notifyBuildComplete: vi.fn().mockResolvedValue(undefined),
      notifyBuildFailed: vi.fn().mockResolvedValue(undefined),
    } as any,
  };
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