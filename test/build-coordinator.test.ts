import { describe, expect, it, vi } from 'vitest';
import { BuildCoordinator } from '../src/core/build-coordinator.js';
import type { TargetState } from '../src/core/target-state.js';
import type { BuildSchedulingConfig, Target } from '../src/types.js';
import { createMockLogger, createMockStateManager, createTestConfig } from './helpers.js';

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
      status: 'success',
      targetName: target.name,
      timestamp: new Date().toISOString(),
    }),
    validate: vi.fn(),
    stop: vi.fn(),
    getOutputInfo: vi.fn(),
    describeBuilder: vi.fn().mockReturnValue('mock'),
  };

  return {
    target,
    builder,
    pendingFiles: new Set(['src/index.ts']),
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

describe('BuildCoordinator', () => {
  it('invokes runner and notifier on successful build', async () => {
    const config = createTestConfig();
    const target = config.targets[0];
    if (!target) {
      throw new Error('Test config missing target');
    }
    const state = createSuccessState(target);
    const notifier: Pick<
      Parameters<typeof BuildCoordinator>[0]['notifier'],
      'notifyBuildComplete' | 'notifyBuildFailed'
    > = {
      notifyBuildComplete: vi.fn(),
      notifyBuildFailed: vi.fn(),
    };

    const coordinator = new BuildCoordinator({
      projectRoot: '/project',
      logger: createMockLogger(),
      stateManager: createMockStateManager(),
      notifier,
      buildSchedulingConfig: baseScheduling,
    });

    await coordinator.buildTarget(target.name, new Map([[target.name, state]]));

    expect(state.runner?.onBuildSuccess).toHaveBeenCalledTimes(1);
    expect(notifier.notifyBuildComplete).toHaveBeenCalledTimes(1);
  });

  it('records failures when build throws', async () => {
    const config = createTestConfig();
    const target = config.targets[0];
    if (!target) {
      throw new Error('Test config missing target');
    }
    const builderError = new Error('boom');

    const state: TargetState = {
      target,
      builder: {
        build: vi.fn().mockRejectedValue(builderError),
        validate: vi.fn(),
        stop: vi.fn(),
        getOutputInfo: vi.fn(),
        describeBuilder: vi.fn().mockReturnValue('mock'),
      },
      pendingFiles: new Set(['src/index.ts']),
      watching: true,
    };

    const stateManager = createMockStateManager();
    const notifier: Pick<Parameters<typeof BuildCoordinator>[0]['notifier'], 'notifyBuildFailed'> =
      {
        notifyBuildFailed: vi.fn(),
      };

    const coordinator = new BuildCoordinator({
      projectRoot: '/project',
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
