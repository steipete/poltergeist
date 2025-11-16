import { describe, expect, it, vi } from 'vitest';
import type { TargetState } from '../src/core/target-state.js';
import { WatchService } from '../src/core/watch-service.js';
import type { PoltergeistConfig } from '../src/types.js';
import { createTestConfig } from './helpers.js';

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

describe('WatchService', () => {
  it('resubscribes on refreshTargets', async () => {
    const config = createTestConfig();
    const watchman = makeMockWatchman();
    const service = new WatchService({
      projectRoot: '/project',
      config,
      logger: noopLogger,
      watchman,
      watchmanConfigManager: mockWatchmanConfigManager,
      onFilesChanged: vi.fn(),
    });

    const initialState = makeTargetState(config, 'src/**/*.ts');
    await service.subscribeTargets(new Map([['t1', initialState]]));

    expect(watchman.subscribe).toHaveBeenCalledTimes(1);
    const firstSubName = watchman.subscribe.mock.calls[0]?.[1];

    const refreshedState = makeTargetState(config, 'lib/**/*.ts');
    await service.refreshTargets(new Map([['t1', refreshedState]]));

    expect(watchman.unsubscribe).toHaveBeenCalledWith(firstSubName);
    expect(watchman.subscribe).toHaveBeenCalledTimes(2);
    const secondSubName = watchman.subscribe.mock.calls[1]?.[1];
    expect(secondSubName).toContain('lib');
  });
});
