import { describe, expect, it, vi } from 'vitest';
import { Poltergeist } from '../src/poltergeist.js';
import type { PoltergeistConfig } from '../src/types.js';
import { createMockLogger } from './helpers.js';

const baseConfig: PoltergeistConfig = {
  version: '1.0',
  projectType: 'node',
  targets: [
    {
      name: 't1',
      type: 'executable',
      enabled: true,
      buildCommand: 'echo ok',
      outputPath: './dist/app',
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
  },
};

describe('config reload refreshes watchman', () => {
  it('invokes watchService.refreshTargets when watchman config changes', async () => {
    const logger = createMockLogger();
    const mockWatchService = { refreshTargets: vi.fn() };
    const ensureConfigUpToDate = vi.fn();

    const poltergeist = new Poltergeist(
      baseConfig,
      '/project',
      logger,
      {
        stateManager: {
          initializeState: vi.fn(),
          readState: vi.fn(),
          updateState: vi.fn(),
          updateBuildStatus: vi.fn(),
          updatePostBuildResult: vi.fn(),
          removeState: vi.fn(),
          isLocked: vi.fn(),
          discoverStates: vi.fn(),
          forceUnlock: vi.fn(),
          startHeartbeat: vi.fn(),
          stopHeartbeat: vi.fn(),
          cleanup: vi.fn(),
        },
        builderFactory: {
          createBuilder: vi.fn().mockReturnValue({
            validate: vi.fn(),
            build: vi.fn(),
            stop: vi.fn(),
            getOutputInfo: vi.fn(),
            describeBuilder: vi.fn(),
          }),
        },
        watchmanClient: {
          connect: vi.fn(),
          disconnect: vi.fn(),
          watchProject: vi.fn(),
          subscribe: vi.fn(),
          unsubscribe: vi.fn(),
          isConnected: vi.fn().mockReturnValue(true),
        },
        notifier: undefined,
        watchmanConfigManager: {
          ensureConfigUpToDate,
          suggestOptimizations: vi.fn().mockResolvedValue([]),
          createExclusionExpressions: vi.fn().mockReturnValue([]),
          normalizeWatchPattern: vi.fn().mockImplementation((p: string) => p),
          validateWatchPattern: vi.fn(),
        },
      },
      '/project/poltergeist.config.json'
    );

    // Inject mock watch service (test-only override)
    (poltergeist as { watchService?: typeof mockWatchService }).watchService = mockWatchService;

    const newConfig = {
      ...baseConfig,
      watchman: {
        ...baseConfig.watchman,
        recrawlThreshold: baseConfig.watchman.recrawlThreshold + 1,
      },
    };

    await poltergeist.applyConfigChanges(newConfig, {
      targetsAdded: [],
      targetsRemoved: [],
      targetsModified: [],
      watchmanChanged: true,
      notificationsChanged: false,
      buildSchedulingChanged: false,
    });

    expect(ensureConfigUpToDate).toHaveBeenCalledTimes(1);
    expect(mockWatchService.refreshTargets).toHaveBeenCalledTimes(1);
  });
});
