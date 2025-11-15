import { describe, expect, test, vi } from 'vitest';
import { createLogger } from '../src/logger.js';
import { Poltergeist } from '../src/poltergeist.js';
import { createMockDependencies } from '../src/factories.js';
import type { PoltergeistConfig, Target } from '../src/types.js';

const logger = createLogger();

const baseConfig: PoltergeistConfig = {
  version: '1.0',
  projectType: 'node',
  targets: [
    {
      name: 'alpha',
      type: 'executable',
      enabled: true,
      buildCommand: 'npm run build:alpha',
      outputPath: './dist/alpha.js',
      watchPaths: ['alpha/**/*.ts'],
    },
    {
      name: 'beta',
      type: 'executable',
      enabled: true,
      buildCommand: 'npm run build:beta',
      outputPath: './dist/beta.js',
      watchPaths: ['beta/**/*.ts'],
    },
  ],
  watchman: {
    useDefaultExclusions: true,
    excludeDirs: [],
    projectType: 'node',
    maxFileEvents: 1000,
    recrawlThreshold: 3,
    settlingDelay: 1000,
  },
  notifications: { enabled: false },
};

describe('Initial Builds', () => {
  test('queues builds for each target when build queue is enabled', async () => {
    const deps = createMockDependencies();
    const poltergeist = new Poltergeist(baseConfig, '/project', logger, deps, '/tmp/config');
    const queueMock = {
      queueTargetBuild: vi.fn().mockResolvedValue(undefined),
    } as any;

    (poltergeist as any).buildQueue = queueMock;
    (poltergeist as any).buildSchedulingConfig = {
      parallelization: 2,
      prioritization: {
        enabled: true,
        focusDetectionWindow: 300000,
        priorityDecayTime: 1800000,
        buildTimeoutMultiplier: 2,
      },
    };

    const fakeBuilder = {
      build: vi.fn(),
      getProjectRoot: () => '/project',
    };

    const targetStates = new Map(
      baseConfig.targets.map((target: Target) => [
        target.name,
        {
          target,
          builder: fakeBuilder,
          watching: false,
          pendingFiles: new Set<string>(),
        },
      ])
    );

    (poltergeist as any).targetStates = targetStates;

    await (poltergeist as any).performInitialBuilds();

    expect(queueMock.queueTargetBuild).toHaveBeenCalledTimes(baseConfig.targets.length);
    expect(queueMock.queueTargetBuild).toHaveBeenCalledWith(baseConfig.targets[0], 'initial-build');
    expect(queueMock.queueTargetBuild).toHaveBeenCalledWith(baseConfig.targets[1], 'initial-build');
  });
});
