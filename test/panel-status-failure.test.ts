import { describe, expect, it, vi } from 'vitest';
import { createPoltergeistWithDeps, createMockDependencies, createTestHarness } from '../src/factories.js';
import { createLogger } from '../src/logger.js';
import { BuildStatusType } from '../src/utils/build-status-manager.js';

const baseConfig = {
  version: '1.0',
  projectType: 'node' as const,
  targets: [
    {
      name: 'alpha',
      type: 'executable' as const,
      enabled: true,
      buildCommand: 'echo alpha',
      outputPath: './dist/alpha.js',
      watchPaths: ['src/**/*.ts'],
    },
  ],
  watchman: {
    useDefaultExclusions: true,
    excludeDirs: [],
    projectType: 'node',
    maxFileEvents: 1000,
    recrawlThreshold: 3,
    settlingDelay: 10,
  },
  notifications: { enabled: false },
};

describe('Panel surface failures', () => {
  it('records a validation failure so the panel can show failure instead of watching', async () => {
    const deps = createMockDependencies();
    const mockWatchmanConfigManager = {
      ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
      removeConfig: vi.fn().mockResolvedValue(undefined),
      suggestOptimizations: vi.fn().mockResolvedValue([]),
      normalizeWatchPattern: vi.fn().mockImplementation((p) => p),
      validateWatchPattern: vi.fn().mockReturnValue(undefined),
      createExclusionExpressions: vi.fn().mockReturnValue([]),
    };
    const poltergeist = createPoltergeistWithDeps(
      baseConfig,
      '/test/project',
      { ...deps, watchmanConfigManager: mockWatchmanConfigManager },
      createLogger()
    );
    const mocks = deps as any;

    const builder = {
      validate: vi.fn().mockRejectedValue(new Error('validation boom')),
      build: vi.fn(),
      describeBuilder: vi.fn().mockReturnValue('mock-builder'),
      getOutputInfo: vi.fn(),
      stop: vi.fn(),
    };

    vi.mocked(mocks.builderFactory.createBuilder).mockReturnValue(builder as any);

    await poltergeist.start();

    expect(mocks.stateManager.updateBuildStatus).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({ status: BuildStatusType.FAILED })
    );
  });

  it('records a build-time exception as failure', async () => {
    const deps = createMockDependencies();
    const mockWatchmanConfigManager = {
      ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
      removeConfig: vi.fn().mockResolvedValue(undefined),
      suggestOptimizations: vi.fn().mockResolvedValue([]),
      normalizeWatchPattern: vi.fn().mockImplementation((p) => p),
      validateWatchPattern: vi.fn().mockReturnValue(undefined),
      createExclusionExpressions: vi.fn().mockReturnValue([]),
    };
    const poltergeist = createPoltergeistWithDeps(
      baseConfig,
      '/test/project',
      { ...deps, watchmanConfigManager: mockWatchmanConfigManager },
      createLogger()
    );
    const mocks = deps as any;

    const builder = {
      validate: vi.fn().mockResolvedValue(undefined),
      build: vi.fn().mockRejectedValue(new Error('build blew up')),
      describeBuilder: vi.fn().mockReturnValue('mock-builder'),
      getOutputInfo: vi.fn(),
      stop: vi.fn(),
    };
    vi.mocked(mocks.builderFactory.createBuilder).mockReturnValue(builder as any);

    await poltergeist.start();

    expect(mocks.stateManager.updateBuildStatus).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({ status: BuildStatusType.FAILED })
    );
  });

  it('marks active-but-never-built targets as failure after grace period', async () => {
    const { poltergeist, mocks } = createTestHarness(baseConfig);

    // No targetStates entry; force getStatus to read from state file
    const staleProcess = {
      pid: 123,
      hostname: 'host',
      isActive: true,
      startTime: new Date(Date.now() - 60_000).toISOString(), // > 30s grace
      lastHeartbeat: new Date(Date.now() - 1_000).toISOString(),
    };

    vi.mocked(mocks.stateManager.readState).mockResolvedValue({
      version: '1.0',
      projectPath: '/test/project',
      projectName: 'test',
      target: 'alpha',
      targetType: 'executable',
      configPath: '/tmp/config',
      process: staleProcess,
    } as any);

    const status = await poltergeist.getStatus('alpha');
    expect(status.alpha?.status).toBe('failure');
  });
});
