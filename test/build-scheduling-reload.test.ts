import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/build-queue.js', () => {
  const registerTarget = vi.fn();
  const queueTargetBuild = vi.fn();
  const onFileChanged = vi.fn();
  const getQueueStatus = vi.fn().mockReturnValue([]);
  const getPriorityInfo = vi.fn().mockReturnValue({});

  const instance = {
    registerTarget,
    queueTargetBuild,
    onFileChanged,
    getQueueStatus,
    getPriorityInfo,
  };

  const ctor = vi.fn().mockImplementation(() => instance);

  return { IntelligentBuildQueue: ctor };
});

import { createTestHarness } from '../src/factories.js';
import { Poltergeist } from '../src/poltergeist.js';
import type { PoltergeistConfig } from '../src/types.js';

const baseConfig: PoltergeistConfig = {
  version: '1.0',
  projectType: 'node',
  buildScheduling: {
    parallelization: 2,
    prioritization: {
      enabled: true,
      focusDetectionWindow: 1_000,
      priorityDecayTime: 10_000,
      buildTimeoutMultiplier: 2,
    },
  },
  targets: [
    {
      name: 't1',
      type: 'executable',
      enabled: true,
      buildCommand: 'echo ok',
      outputPath: './dist/app',
      watchPaths: ['src/**/*.ts'],
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

describe('build scheduling reload', () => {
  it('recreates queue and re-registers targets on scheduling change', async () => {
    process.env.ENABLE_QUEUE_FOR_TESTS = '1';
    const harness = createTestHarness(baseConfig);

    // Provide a mock watchman config manager to avoid fs writes
    harness.mocks.watchmanConfigManager = {
      ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
      suggestOptimizations: vi.fn().mockResolvedValue([]),
      createExclusionExpressions: vi.fn().mockReturnValue([]),
      normalizeWatchPattern: vi.fn().mockImplementation((p: string) => p),
      validateWatchPattern: vi.fn(),
    } as any;

    const poltergeist = new Poltergeist(
      baseConfig,
      '/project',
      harness.logger,
      harness.mocks,
      '/project/poltergeist.config.json'
    );

    await poltergeist.start(undefined, { waitForInitialBuilds: false });

    const { IntelligentBuildQueue } = await import('../src/build-queue.js');

    // First queue created in start()
    expect(IntelligentBuildQueue).toHaveBeenCalledTimes(1);

    const newConfig: PoltergeistConfig = {
      ...baseConfig,
      buildScheduling: {
        ...(baseConfig.buildScheduling ?? {
          parallelization: 2,
          prioritization: {
            enabled: true,
            focusDetectionWindow: 1_000,
            priorityDecayTime: 10_000,
            buildTimeoutMultiplier: 2,
          },
        }),
        parallelization: 4,
      },
    };

    await poltergeist.applyConfigChanges(newConfig, {
      targetsAdded: [],
      targetsRemoved: [],
      targetsModified: [],
      watchmanChanged: false,
      notificationsChanged: false,
      buildSchedulingChanged: true,
    });

    // New queue created
    expect(IntelligentBuildQueue).toHaveBeenCalledTimes(2);

    const lastQueueInstance = (
      IntelligentBuildQueue as unknown as { mock: { results: Array<{ value: any }> } }
    ).mock.results[1]?.value;
    expect(lastQueueInstance.registerTarget).toHaveBeenCalledWith(
      expect.objectContaining({ name: 't1' }),
      expect.any(Object)
    );
  });
});
