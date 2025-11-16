import { describe, expect, it, vi } from 'vitest';
import { TargetLifecycleManager } from '../src/core/target-lifecycle.js';
import type { Target } from '../src/types.js';

const logger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
};

const createTarget = (name: string): Target => ({
  name,
  type: 'executable',
  enabled: true,
  buildCommand: 'echo ok',
  outputPath: './dist',
  watchPaths: ['src/**/*.ts'],
});

const makeDeps = () => {
  const stateManager = {
    initializeState: vi.fn().mockResolvedValue(undefined),
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
  };

  const builderFactory = {
    createBuilder: vi.fn().mockReturnValue({
      validate: vi.fn().mockResolvedValue(undefined),
      build: vi.fn(),
      stop: vi.fn(),
      getOutputInfo: vi.fn(),
      describeBuilder: vi.fn(),
    }),
  };

  return { stateManager, builderFactory };
};

describe('TargetLifecycleManager', () => {
  it('initializes targets and registers with build queue', async () => {
    const { stateManager, builderFactory } = makeDeps();
    const buildQueue = { registerTarget: vi.fn() } as any;
    const manager = new TargetLifecycleManager({
      projectRoot: '/project',
      logger,
      stateManager: stateManager as any,
      builderFactory: builderFactory as any,
    });

    await manager.initTargets([createTarget('t1')], buildQueue);

    expect(builderFactory.createBuilder).toHaveBeenCalled();
    expect(buildQueue.registerTarget).toHaveBeenCalledWith(
      expect.objectContaining({ name: 't1' }),
      expect.any(Object)
    );
    expect(stateManager.initializeState).toHaveBeenCalledWith(
      expect.objectContaining({ name: 't1' })
    );
    expect(manager.getTargetStates().has('t1')).toBe(true);
  });

  it('removes targets and cleans state', async () => {
    const { stateManager, builderFactory } = makeDeps();
    const manager = new TargetLifecycleManager({
      projectRoot: '/project',
      logger,
      stateManager: stateManager as any,
      builderFactory: builderFactory as any,
    });
    await manager.initTargets([createTarget('t1')]);
    await manager.removeTargets(['t1']);
    expect(stateManager.removeState).toHaveBeenCalledWith('t1');
    expect(manager.getTargetStates().has('t1')).toBe(false);
  });
});
