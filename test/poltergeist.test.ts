// Integration tests for Poltergeist main class

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseBuilder } from '../src/builders/index.js';
import { Poltergeist } from '../src/poltergeist.js';
import { StateManager } from '../src/state.js';
import type { AppBundleTarget, ExecutableTarget } from '../src/types.js';
import { createTestHarness, simulateFileChange, type TestHarness } from './helpers.js';

// Mock StateManager static methods
vi.mock('../src/state.js', async () => {
  const actual = await vi.importActual('../src/state.js');
  return {
    ...actual,
    StateManager: {
      ...actual.StateManager,
      listAllStates: vi.fn().mockResolvedValue([]),
    },
  };
});

describe('Poltergeist', () => {
  let poltergeist: Poltergeist;
  let harness: TestHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Setup test harness with config
    harness = createTestHarness({
      version: '1.0',
      projectType: 'mixed',
      targets: [
        {
          name: 'cli',
          type: 'executable',
          enabled: true,
          buildCommand: 'npm run build',
          outputPath: './dist/cli',
          watchPaths: ['src/**/*.ts'],
          settlingDelay: 100,
        } as ExecutableTarget,
        {
          name: 'app',
          type: 'app-bundle',
          platform: 'macos',
          enabled: true,
          buildCommand: 'xcodebuild',
          bundleId: 'com.example.app',
          watchPaths: ['app/**/*.swift'],
          settlingDelay: 200,
        } as AppBundleTarget,
      ],
      watchman: {
        useDefaultExclusions: true,
        excludeDirs: [],
        projectType: 'mixed',
        maxFileEvents: 10000,
        recrawlThreshold: 5,
        settlingDelay: 1000,
      },
      buildScheduling: {
        parallelization: 2,
        prioritization: {
          enabled: true,
          focusDetectionWindow: 300000,
          priorityDecayTime: 1800000,
          buildTimeoutMultiplier: 2.0,
        },
      },
      notifications: {
        enabled: true,
        buildStart: true,
        buildFailed: true,
        buildSuccess: true,
      },
    });

    // Setup builder mock for CLI target
    const cliBuilder = harness.builderFactory.builders.get('cli');
    if (cliBuilder) {
      vi.mocked(cliBuilder.build).mockResolvedValue({
        status: 'success',
        targetName: 'cli',
        timestamp: new Date().toISOString(),
        duration: 1234,
      });
      vi.mocked(cliBuilder.getOutputInfo).mockReturnValue('/dist/cli');
    }

    // Enable notifications in the mock notifier for these tests
    if (harness.deps.notifier) {
      harness.deps.notifier.config.enabled = true;
    }

    poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
  });

  afterEach(() => {
    vi.useRealTimers();
    // Remove all listeners to prevent memory leak warnings
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('exit');
  });

  // Helper to start Poltergeist and clear initial build calls
  async function _startAndClearBuilds() {
    await poltergeist.start();
    harness.builderFactory.builders.forEach((builder) => vi.mocked(builder.build).mockClear());
  }

  describe('constructor', () => {
    it('should initialize with provided config and logger', () => {
      expect(poltergeist).toBeInstanceOf(Poltergeist);
    });
  });

  describe('start', () => {
    it('should start watching all enabled targets', async () => {
      await poltergeist.start();

      // Should start heartbeat
      expect(harness.stateManager.startHeartbeat).toHaveBeenCalled();

      // Should create builders for all enabled targets
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledTimes(2);
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledWith(
        harness.config.targets[0],
        '/test/project',
        harness.logger,
        harness.stateManager
      );

      // Should validate builders
      const cliBuilder = harness.builderFactory.builders.get('cli');
      const appBuilder = harness.builderFactory.builders.get('app');
      expect(cliBuilder?.validate).toHaveBeenCalled();
      expect(appBuilder?.validate).toHaveBeenCalled();

      // Should connect to watchman
      const watchmanClient = harness.watchmanClient;
      expect(watchmanClient.connect).toHaveBeenCalled();
      expect(watchmanClient.watchProject).toHaveBeenCalledWith('/test/project');

      // Initial builds may or may not be called depending on configuration
      // Main thing is that the system starts successfully

      expect(harness.logger.info).toHaveBeenCalledWith(
        '👻 [Poltergeist] is now watching for changes...'
      );
    });

    it('should start watching specific target', async () => {
      await poltergeist.start('cli');

      // Should only create builder for specified target
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledTimes(1);
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledWith(
        harness.config.targets[0],
        '/test/project',
        harness.logger,
        harness.stateManager
      );

      // Should create builder for specified target
      const cliBuilder = harness.builderFactory.builders.get('cli');
      expect(cliBuilder).toBeDefined();
      // Initial builds may or may not be called depending on configuration
    });

    it('should throw error if target not found', async () => {
      await expect(poltergeist.start('nonexistent')).rejects.toThrow(
        "Target 'nonexistent' not found"
      );
    });

    it('should throw error if target is disabled', async () => {
      harness.config.targets[0].enabled = false;

      await expect(poltergeist.start('cli')).rejects.toThrow("Target 'cli' is disabled");
    });

    it('should continue running with warning if no targets to watch', async () => {
      harness.config.targets.forEach((t) => {
        t.enabled = false;
      });

      await poltergeist.start();

      expect(harness.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No enabled targets found')
      );
    });

    it('should throw error if already running', async () => {
      await poltergeist.start();

      await expect(poltergeist.start()).rejects.toThrow('Poltergeist is already running');
    });

    it('should handle builder validation failure', async () => {
      // Mock the builderFactory to return a builder that fails validation
      const mockBuilder = {
        validate: vi.fn().mockRejectedValueOnce(new Error('Invalid configuration')),
        build: vi.fn(),
        stop: vi.fn(),
        getOutputInfo: vi.fn(),
        target: harness.config.targets[0],
        projectRoot: '/test/project',
        logger: harness.logger,
        stateManager: harness.deps.stateManager,
        currentProcess: undefined,
      };
      vi.mocked(harness.builderFactory.createBuilder).mockReturnValueOnce(
        mockBuilder as BaseBuilder
      );

      await expect(poltergeist.start()).rejects.toThrow('Invalid configuration');
    });
  });

  describe('file change handling', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      await poltergeist.start();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should build target after file changes with settling delay', async () => {
      const cliBuilder = harness.builderFactory.builders.get('cli');

      // Clear initial build calls
      vi.mocked(cliBuilder?.build).mockClear();

      // Simulate file change
      simulateFileChange(harness.watchmanClient, ['src/main.ts', 'src/utils.ts']);

      // Should not build immediately
      expect(cliBuilder?.build).not.toHaveBeenCalled();

      // Advance timers by settling delay
      await vi.advanceTimersByTimeAsync(100);

      // Should build after settling delay
      expect(cliBuilder?.build).toHaveBeenCalledWith(
        ['src/main.ts', 'src/utils.ts'],
        expect.objectContaining({
          captureLogs: true,
          logFile: expect.stringContaining('cli.log'),
        })
      );
    });

    it('should reset timer on subsequent file changes', async () => {
      const cliBuilder = harness.builderFactory.builders.get('cli');

      // Clear initial build calls
      vi.mocked(cliBuilder?.build).mockClear();

      // First file change
      simulateFileChange(harness.watchmanClient, ['src/main.ts'], 0);

      // Advance timer partially
      vi.advanceTimersByTime(50);

      // Second file change should reset timer
      simulateFileChange(harness.watchmanClient, ['src/utils.ts'], 0);

      // Advance timer to original settling time
      vi.advanceTimersByTime(50);

      // Should not have built yet
      expect(cliBuilder?.build).not.toHaveBeenCalled();

      // Advance remaining time and wait for async operations
      vi.advanceTimersByTime(50);
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Should build with both files
      expect(cliBuilder?.build).toHaveBeenCalledWith(
        ['src/main.ts', 'src/utils.ts'],
        expect.objectContaining({
          captureLogs: true,
          logFile: expect.stringContaining('cli.log'),
        })
      );
    });

    it('should ignore non-existent files', async () => {
      const cliBuilder = harness.builderFactory.builders.get('cli');

      // Clear initial build calls
      vi.mocked(cliBuilder?.build).mockClear();

      // Simulate file deletion - manually call the handler with mixed exists states
      const subscribeCall = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];
      changeHandler([
        { name: 'src/deleted.ts', exists: false, type: 'f' },
        { name: 'src/exists.ts', exists: true, type: 'f' },
      ]);

      await vi.advanceTimersByTimeAsync(100);

      // Should only build with existing file
      expect(cliBuilder?.build).toHaveBeenCalledWith(
        ['src/exists.ts'],
        expect.objectContaining({
          captureLogs: true,
          logFile: expect.stringContaining('cli.log'),
        })
      );
    });

    it('should ignore non-file changes', async () => {
      const cliBuilder = harness.builderFactory.builders.get('cli');

      // Clear initial build calls
      vi.mocked(cliBuilder?.build).mockClear();

      // Simulate directory change - manually call the handler
      const subscribeCall = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];
      changeHandler([{ name: 'src/newdir', exists: true, type: 'd' }]);

      await vi.advanceTimersByTimeAsync(100);

      // Should not trigger build
      expect(cliBuilder?.build).not.toHaveBeenCalled();
    });
  });

  describe('build notifications', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      await poltergeist.start();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should notify on successful build', async () => {
      const cliBuilder = harness.builderFactory.builders.get('cli');
      vi.mocked(cliBuilder?.build).mockClear();
      vi.mocked(cliBuilder?.build).mockResolvedValueOnce({
        status: 'success',
        targetName: 'cli',
        timestamp: new Date().toISOString(),
        duration: 2500,
      });

      simulateFileChange(harness.watchmanClient, ['src/main.ts'], 0);

      // Wait for settling delay and async operations
      vi.advanceTimersByTime(110);
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Check that build was called and notifyBuildComplete was called
      expect(cliBuilder?.build).toHaveBeenCalled();
      expect(harness.deps.notifier?.notifyBuildComplete).toHaveBeenCalled();

      // Get the actual call and verify it matches expected pattern
      const call = vi
        .mocked(harness.deps.notifier?.notifyBuildComplete)
        .mock.calls.find((c) => c[0] === 'cli Built' && c[1].includes('2.5s'));
      expect(call).toBeDefined();
    });

    it('should notify on failed build', async () => {
      const cliBuilder = harness.builderFactory.builders.get('cli');
      vi.mocked(cliBuilder?.build).mockClear();
      vi.mocked(cliBuilder?.build).mockResolvedValueOnce({
        status: 'failure',
        targetName: 'cli',
        timestamp: new Date().toISOString(),
        error: 'Compilation error',
        errorSummary: 'TypeScript error: Type mismatch',
      });

      simulateFileChange(harness.watchmanClient, ['src/main.ts'], 0);

      // Wait for settling delay and async operations
      vi.advanceTimersByTime(110);
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Check that build was called and notifyBuildFailed was called
      expect(cliBuilder?.build).toHaveBeenCalled();
      expect(harness.deps.notifier?.notifyBuildFailed).toHaveBeenCalledWith(
        'cli Failed',
        'TypeScript error: Type mismatch',
        undefined
      );
    });

    it('should handle build exceptions', async () => {
      const cliBuilder = harness.builderFactory.builders.get('cli');
      vi.mocked(cliBuilder?.build).mockClear();
      vi.mocked(cliBuilder?.build).mockRejectedValueOnce(new Error('Build process crashed'));

      simulateFileChange(harness.watchmanClient, ['src/main.ts'], 0);

      // Wait for settling delay and async operations
      vi.advanceTimersByTime(110);
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Check that build was called and error was logged properly
      expect(cliBuilder?.build).toHaveBeenCalled();
      expect(harness.logger.error).toHaveBeenCalledWith(
        'Build failed for cli: Error: Build process crashed'
      );
      expect(harness.deps.notifier?.notifyBuildFailed).toHaveBeenCalledWith(
        'cli Error',
        'Build process crashed',
        undefined
      );
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      await poltergeist.start();
    });

    it('should stop all targets', async () => {
      await poltergeist.stop();

      // Should stop all builders
      const cliBuilder = harness.builderFactory.builders.get('cli');
      const appBuilder = harness.builderFactory.builders.get('app');
      expect(cliBuilder?.stop).toHaveBeenCalled();
      expect(appBuilder?.stop).toHaveBeenCalled();

      // Should disconnect from watchman
      expect(harness.watchmanClient.disconnect).toHaveBeenCalled();

      // Should cleanup state manager
      expect(harness.stateManager.cleanup).toHaveBeenCalled();

      expect(harness.logger.info).toHaveBeenCalledWith(
        '👻 [Poltergeist] Poltergeist is now at rest'
      );
    });

    it('should stop specific target', async () => {
      await poltergeist.stop('cli');

      // Should only stop specific builder
      const cliBuilder = harness.builderFactory.builders.get('cli');
      expect(cliBuilder?.stop).toHaveBeenCalled();

      // Should not disconnect watchman (other targets still running)
      expect(harness.watchmanClient.disconnect).not.toHaveBeenCalled();

      // Should remove state for specific target
      expect(harness.stateManager.removeState).toHaveBeenCalledWith('cli');
    });

    it('should handle stop when target not found', async () => {
      await poltergeist.stop('nonexistent');

      // Should not throw error
      const cliBuilder = harness.builderFactory.builders.get('cli');
      const appBuilder = harness.builderFactory.builders.get('app');
      expect(cliBuilder?.stop).not.toHaveBeenCalled();
      expect(appBuilder?.stop).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    beforeEach(async () => {
      await poltergeist.start();
    });

    it('should return status for all targets', async () => {
      vi.mocked(harness.stateManager.readState).mockImplementation((targetName: string) => {
        if (targetName === 'cli') {
          return Promise.resolve({
            targetName: 'cli',
            process: { pid: 1234, isActive: true },
            lastBuild: {
              status: 'success',
              timestamp: '2023-01-01T00:00:00Z',
            },
            appInfo: {
              outputPath: '/dist/cli',
            },
          });
        }
        return Promise.resolve(null);
      });

      const status = await poltergeist.getStatus();

      expect(status).toHaveProperty('cli');
      expect(status.cli).toEqual({
        status: 'idle',
        enabled: true,
        type: 'executable',
        process: { pid: 1234, isActive: true },
        lastBuild: {
          status: 'success',
          timestamp: '2023-01-01T00:00:00Z',
        },
        appInfo: {
          outputPath: '/dist/cli',
        },
        pendingFiles: 0,
        buildStats: undefined,
        buildCommand: 'npm run build',
      });

      expect(status).toHaveProperty('app');
      expect(status.app.status).toBe('not running');
    });

    it('should return status for specific target', async () => {
      vi.mocked(harness.stateManager.readState).mockResolvedValue({
        targetName: 'cli',
        process: { pid: 1234, isActive: false },
        lastBuild: {
          status: 'failure',
          timestamp: '2023-01-01T00:00:00Z',
        },
      });

      const status = await poltergeist.getStatus('cli');

      expect(status).toHaveProperty('cli');
      expect(status.cli).toEqual({
        status: 'idle',
        process: { pid: 1234, isActive: false },
        lastBuild: {
          status: 'failure',
          timestamp: '2023-01-01T00:00:00Z',
        },
        appInfo: undefined,
        pendingFiles: 0,
        buildStats: undefined,
        buildCommand: 'npm run build',
      });
      // When intelligent build scheduling is enabled, status may include _buildQueue
      const targetKeys = Object.keys(status).filter((key) => !key.startsWith('_'));
      expect(targetKeys).toEqual(['cli']);
    });

    it('should return not found for unknown target', async () => {
      const status = await poltergeist.getStatus('nonexistent');

      expect(status).toHaveProperty('nonexistent');
      expect(status.nonexistent).toEqual({ status: 'not found' });
      // When intelligent build scheduling is enabled, status may include _buildQueue
      const targetKeys = Object.keys(status).filter((key) => !key.startsWith('_'));
      expect(targetKeys).toEqual(['nonexistent']);
    });

    it('should handle state without active poltergeist', async () => {
      await poltergeist.stop();

      vi.mocked(harness.stateManager.readState).mockResolvedValue({
        targetName: 'cli',
        process: { pid: 1234, isActive: true },
        lastBuild: {
          status: 'success',
          timestamp: '2023-01-01T00:00:00Z',
        },
      });

      const status = await poltergeist.getStatus('cli');

      expect(status).toHaveProperty('cli');
      expect(status.cli).toEqual({
        status: 'running',
        process: { pid: 1234, isActive: true },
        lastBuild: {
          status: 'success',
          timestamp: '2023-01-01T00:00:00Z',
        },
        appInfo: undefined,
        buildStats: undefined,
        buildCommand: 'npm run build',
      });
      // When intelligent build scheduling is enabled, status may include _buildQueue
      const targetKeys = Object.keys(status).filter((key) => !key.startsWith('_'));
      expect(targetKeys).toEqual(['cli']);
    });
  });

  describe('listAllStates', () => {
    it('should list all poltergeist states', async () => {
      vi.mocked(StateManager.listAllStates).mockResolvedValue([
        'project1-hash1-cli.state',
        'project2-hash2-app.state',
      ]);

      const _states = await Poltergeist.listAllStates();

      expect(StateManager.listAllStates).toHaveBeenCalled();
    });

    it('should handle invalid state files gracefully', async () => {
      vi.mocked(StateManager.listAllStates).mockResolvedValue(['invalid.state']);

      // The actual implementation will handle errors gracefully
      const states = await Poltergeist.listAllStates();

      expect(states).toEqual([]);
    });
  });

  describe('graceful shutdown', () => {
    it('should handle SIGINT', async () => {
      await poltergeist.start();

      const stopSpy = vi.spyOn(poltergeist, 'stop');
      process.emit('SIGINT', 'SIGINT');

      expect(stopSpy).toHaveBeenCalled();
    });

    it('should handle SIGTERM', async () => {
      await poltergeist.start();

      const stopSpy = vi.spyOn(poltergeist, 'stop');
      process.emit('SIGTERM', 'SIGTERM');

      expect(stopSpy).toHaveBeenCalled();
    });
  });
});
