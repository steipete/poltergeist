// Integration tests for Poltergeist main class
import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { Poltergeist } from '../src/poltergeist.js';
import { PoltergeistConfig, ExecutableTarget, AppBundleTarget } from '../src/types.js';
import { Logger } from '../src/logger.js';
import { WatchmanClient } from '../src/watchman.js';
import { BuilderFactory, BaseBuilder } from '../src/builders/index.js';
import { BuildNotifier } from '../src/notifier.js';
import { StateManager } from '../src/state.js';
import { EventEmitter } from 'events';

// Mock all dependencies
vi.mock('../src/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
  Logger: vi.fn(),
}));

vi.mock('../src/watchman.js', () => ({
  WatchmanClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    watchProject: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/builders/index.js', () => ({
  BuilderFactory: {
    createBuilder: vi.fn(),
  },
  BaseBuilder: vi.fn(),
}));

vi.mock('../src/notifier.js', () => ({
  BuildNotifier: vi.fn().mockImplementation(() => ({
    notifyBuildStart: vi.fn().mockResolvedValue(undefined),
    notifyBuildFailed: vi.fn().mockResolvedValue(undefined),
    notifyBuildComplete: vi.fn().mockResolvedValue(undefined),
    notifyPoltergeistStarted: vi.fn().mockResolvedValue(undefined),
    notifyPoltergeistStopped: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/state.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    startHeartbeat: vi.fn(),
    initializeState: vi.fn().mockResolvedValue({}),
    updateBuildStatus: vi.fn().mockResolvedValue(undefined),
    updateAppInfo: vi.fn().mockResolvedValue(undefined),
    readState: vi.fn().mockResolvedValue(null),
    removeState: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  })),
  listAllStates: vi.fn().mockResolvedValue([]),
}));

describe('Poltergeist', () => {
  let poltergeist: Poltergeist;
  let mockLogger: Logger;
  let mockStateManager: StateManager;
  let mockBuilder: BaseBuilder;
  let mockWatchmanClient: WatchmanClient;
  let config: PoltergeistConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any;

    // Setup mock builder
    mockBuilder = {
      validate: vi.fn().mockResolvedValue(undefined),
      build: vi.fn().mockResolvedValue({
        status: 'success',
        targetName: 'cli',
        timestamp: new Date().toISOString(),
        duration: 1234,
      }),
      stop: vi.fn(),
      getOutputInfo: vi.fn().mockReturnValue('/dist/cli'),
    } as any;

    vi.mocked(BuilderFactory.createBuilder).mockReturnValue(mockBuilder);

    // Setup basic config
    config = {
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
      notifications: {
        enabled: true,
        buildStart: true,
        buildFailed: true,
        buildSuccess: true,
      },
    };

    poltergeist = new Poltergeist(config, '/test/project', mockLogger);
  });

  afterEach(() => {
    // Clean up any timers
    vi.clearAllTimers();
    // Remove all listeners to prevent memory leak warnings
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('exit');
  });

  describe('constructor', () => {
    it('should initialize with provided config and logger', () => {
      expect(poltergeist).toBeInstanceOf(Poltergeist);
      expect(StateManager).toHaveBeenCalledWith('/test/project', mockLogger);
    });

    it('should create default logger if not provided', () => {
      const poltergeistWithoutLogger = new Poltergeist(config, '/test/project');
      expect(poltergeistWithoutLogger).toBeInstanceOf(Poltergeist);
    });
  });

  describe('start', () => {
    it('should start watching all enabled targets', async () => {
      await poltergeist.start();

      // Should start heartbeat
      const stateManager = vi.mocked(StateManager).mock.results[0].value;
      expect(stateManager.startHeartbeat).toHaveBeenCalled();

      // Should create notifier
      expect(BuildNotifier).toHaveBeenCalledWith(config.notifications);

      // Should create builders for all enabled targets
      expect(BuilderFactory.createBuilder).toHaveBeenCalledTimes(2);
      expect(BuilderFactory.createBuilder).toHaveBeenCalledWith(
        config.targets[0],
        '/test/project',
        mockLogger,
        expect.any(Object)
      );

      // Should validate builders
      expect(mockBuilder.validate).toHaveBeenCalledTimes(2);

      // Should connect to watchman
      expect(WatchmanClient).toHaveBeenCalled();
      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      expect(watchmanClient.connect).toHaveBeenCalled();
      expect(watchmanClient.watchProject).toHaveBeenCalledWith('/test/project');

      // Should perform initial builds
      expect(mockBuilder.build).toHaveBeenCalledTimes(2);

      expect(mockLogger.info).toHaveBeenCalledWith('👻 [Poltergeist] is now watching for changes...');
    });

    it('should start watching specific target', async () => {
      await poltergeist.start('cli');

      // Should only create builder for specified target
      expect(BuilderFactory.createBuilder).toHaveBeenCalledTimes(1);
      expect(BuilderFactory.createBuilder).toHaveBeenCalledWith(
        config.targets[0],
        '/test/project',
        mockLogger,
        expect.any(Object)
      );

      expect(mockBuilder.build).toHaveBeenCalledTimes(1);
    });

    it('should throw error if target not found', async () => {
      await expect(poltergeist.start('nonexistent')).rejects.toThrow(
        "Target 'nonexistent' not found"
      );
    });

    it('should throw error if target is disabled', async () => {
      config.targets[0].enabled = false;
      
      await expect(poltergeist.start('cli')).rejects.toThrow(
        "Target 'cli' is disabled"
      );
    });

    it('should throw error if no targets to watch', async () => {
      config.targets.forEach(t => t.enabled = false);
      
      await expect(poltergeist.start()).rejects.toThrow('No targets to watch');
    });

    it('should throw error if already running', async () => {
      await poltergeist.start();
      
      await expect(poltergeist.start()).rejects.toThrow('Poltergeist is already running');
    });

    it('should handle builder validation failure', async () => {
      mockBuilder.validate.mockRejectedValueOnce(new Error('Invalid configuration'));
      
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
      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      const subscribeCall = vi.mocked(watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      // Clear initial build calls
      vi.mocked(mockBuilder.build).mockClear();

      // Simulate file change
      changeHandler([
        { name: 'src/main.ts', exists: true, type: 'f' },
        { name: 'src/utils.ts', exists: true, type: 'f' },
      ]);

      // Should not build immediately
      expect(mockBuilder.build).not.toHaveBeenCalled();

      // Advance timers by settling delay
      await vi.advanceTimersByTimeAsync(100);

      // Should build after settling delay
      expect(mockBuilder.build).toHaveBeenCalledWith(['src/main.ts', 'src/utils.ts']);
    });

    it('should reset timer on subsequent file changes', async () => {
      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      const subscribeCall = vi.mocked(watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      // Clear initial build calls
      vi.mocked(mockBuilder.build).mockClear();

      // First file change
      changeHandler([{ name: 'src/main.ts', exists: true, type: 'f' }]);

      // Advance timer partially
      await vi.advanceTimersByTimeAsync(50);

      // Second file change should reset timer
      changeHandler([{ name: 'src/utils.ts', exists: true, type: 'f' }]);

      // Advance timer to original settling time
      await vi.advanceTimersByTimeAsync(50);

      // Should not have built yet
      expect(mockBuilder.build).not.toHaveBeenCalled();

      // Advance remaining time
      await vi.advanceTimersByTimeAsync(50);

      // Should build with both files
      expect(mockBuilder.build).toHaveBeenCalledWith(['src/main.ts', 'src/utils.ts']);
    });

    it('should ignore non-existent files', async () => {
      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      const subscribeCall = vi.mocked(watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      // Clear initial build calls
      vi.mocked(mockBuilder.build).mockClear();

      // Simulate file deletion
      changeHandler([
        { name: 'src/deleted.ts', exists: false, type: 'f' },
        { name: 'src/exists.ts', exists: true, type: 'f' },
      ]);

      await vi.advanceTimersByTimeAsync(100);

      // Should only build with existing file
      expect(mockBuilder.build).toHaveBeenCalledWith(['src/exists.ts']);
    });

    it('should ignore non-file changes', async () => {
      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      const subscribeCall = vi.mocked(watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      // Clear initial build calls
      vi.mocked(mockBuilder.build).mockClear();

      // Simulate directory change
      changeHandler([
        { name: 'src/newdir', exists: true, type: 'd' },
      ]);

      await vi.advanceTimersByTimeAsync(100);

      // Should not trigger build
      expect(mockBuilder.build).not.toHaveBeenCalled();
    });
  });

  describe('build notifications', () => {
    let mockNotifier: BuildNotifier;

    beforeEach(async () => {
      vi.useFakeTimers();
      await poltergeist.start();
      mockNotifier = vi.mocked(BuildNotifier).mock.results[0].value;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should notify on successful build', async () => {
      vi.mocked(mockBuilder.build).mockResolvedValueOnce({
        status: 'success',
        targetName: 'cli',
        timestamp: new Date().toISOString(),
        duration: 2500,
      });

      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      const subscribeCall = vi.mocked(watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      changeHandler([{ name: 'src/main.ts', exists: true, type: 'f' }]);
      await vi.runAllTimersAsync();

      expect(mockNotifier.notifyBuildComplete).toHaveBeenCalledWith(
        'cli Built',
        'Built: /dist/cli in 2.5s',
        undefined
      );
    });

    it('should notify on failed build', async () => {
      vi.mocked(mockBuilder.build).mockResolvedValueOnce({
        status: 'failure',
        targetName: 'cli',
        timestamp: new Date().toISOString(),
        error: 'Compilation error',
        errorSummary: 'TypeScript error: Type mismatch',
      });

      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      const subscribeCall = vi.mocked(watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      changeHandler([{ name: 'src/main.ts', exists: true, type: 'f' }]);
      await vi.runAllTimersAsync();

      expect(mockNotifier.notifyBuildFailed).toHaveBeenCalledWith(
        'cli Failed',
        'TypeScript error: Type mismatch',
        undefined
      );
    });

    it('should handle build exceptions', async () => {
      vi.mocked(mockBuilder.build).mockRejectedValueOnce(new Error('Build process crashed'));

      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      const subscribeCall = vi.mocked(watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      changeHandler([{ name: 'src/main.ts', exists: true, type: 'f' }]);
      await vi.runAllTimersAsync();

      expect(mockLogger.error).toHaveBeenCalledWith('[cli] Build error: Build process crashed');
      expect(mockNotifier.notifyBuildFailed).toHaveBeenCalledWith(
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
      expect(mockBuilder.stop).toHaveBeenCalledTimes(2);

      // Should disconnect from watchman
      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      expect(watchmanClient.disconnect).toHaveBeenCalled();

      // Should cleanup state manager
      const stateManager = vi.mocked(StateManager).mock.results[0].value;
      expect(stateManager.cleanup).toHaveBeenCalled();

      expect(mockLogger.info).toHaveBeenCalledWith('👻 [Poltergeist] Poltergeist is now at rest');
    });

    it('should stop specific target', async () => {
      await poltergeist.stop('cli');

      // Should only stop specific builder
      expect(mockBuilder.stop).toHaveBeenCalledTimes(1);

      // Should not disconnect watchman (other targets still running)
      const watchmanClient = vi.mocked(WatchmanClient).mock.results[0].value;
      expect(watchmanClient.disconnect).not.toHaveBeenCalled();

      // Should remove state for specific target
      const stateManager = vi.mocked(StateManager).mock.results[0].value;
      expect(stateManager.removeState).toHaveBeenCalledWith('cli');
    });

    it('should handle stop when target not found', async () => {
      await poltergeist.stop('nonexistent');

      // Should not throw error
      expect(mockBuilder.stop).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    let mockStateManager: any;

    beforeEach(async () => {
      mockStateManager = vi.mocked(StateManager).mock.results[0].value;
      await poltergeist.start();
    });

    it('should return status for all targets', async () => {
      mockStateManager.readState.mockImplementation((targetName: string) => {
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
      });

      expect(status).toHaveProperty('app');
      expect(status.app.status).toBe('not running');
    });

    it('should return status for specific target', async () => {
      mockStateManager.readState.mockResolvedValue({
        targetName: 'cli',
        process: { pid: 1234, isActive: false },
        lastBuild: {
          status: 'failure',
          timestamp: '2023-01-01T00:00:00Z',
        },
      });

      const status = await poltergeist.getStatus('cli');

      expect(status).toEqual({
        cli: {
          status: 'idle',
          process: { pid: 1234, isActive: false },
          lastBuild: {
            status: 'failure',
            timestamp: '2023-01-01T00:00:00Z',
          },
          appInfo: undefined,
          pendingFiles: 0,
        },
      });
    });

    it('should return not found for unknown target', async () => {
      const status = await poltergeist.getStatus('nonexistent');

      expect(status).toEqual({
        nonexistent: { status: 'not found' },
      });
    });

    it('should handle state without active poltergeist', async () => {
      await poltergeist.stop();

      mockStateManager.readState.mockResolvedValue({
        targetName: 'cli',
        process: { pid: 1234, isActive: true },
        lastBuild: {
          status: 'success',
          timestamp: '2023-01-01T00:00:00Z',
        },
      });

      const status = await poltergeist.getStatus('cli');

      expect(status).toEqual({
        cli: {
          status: 'running',
          process: { pid: 1234, isActive: true },
          lastBuild: {
            status: 'success',
            timestamp: '2023-01-01T00:00:00Z',
          },
          appInfo: undefined,
        },
      });
    });
  });

  describe('listAllStates', () => {
    it('should list all poltergeist states', async () => {
      const mockListAllStates = vi.fn().mockResolvedValue(['project1-hash1-cli.state', 'project2-hash2-app.state']);
      vi.mocked(StateManager).listAllStates = mockListAllStates;

      const states = await Poltergeist.listAllStates();

      expect(mockListAllStates).toHaveBeenCalled();
      expect(StateManager).toHaveBeenCalledTimes(3); // 1 for poltergeist constructor + 2 for reading states
    });

    it('should handle invalid state files gracefully', async () => {
      const mockListAllStates = vi.fn().mockResolvedValue(['invalid.state']);
      vi.mocked(StateManager).listAllStates = mockListAllStates;

      const mockReadState = vi.fn().mockRejectedValue(new Error('Invalid state'));
      vi.mocked(StateManager).mockImplementation(() => ({
        readState: mockReadState,
      }) as any);

      const states = await Poltergeist.listAllStates();

      expect(states).toEqual([]);
    });
  });

  describe('graceful shutdown', () => {
    beforeEach(() => {
      // Ensure StateManager mock has all required methods
      const stateManager = vi.mocked(StateManager).mock.results[0]?.value;
      if (stateManager) {
        stateManager.startHeartbeat = vi.fn();
        stateManager.initializeState = vi.fn().mockResolvedValue({});
        stateManager.updateBuildStatus = vi.fn().mockResolvedValue(undefined);
        stateManager.updateAppInfo = vi.fn().mockResolvedValue(undefined);
        stateManager.readState = vi.fn().mockResolvedValue(null);
        stateManager.removeState = vi.fn().mockResolvedValue(undefined);
        stateManager.cleanup = vi.fn().mockResolvedValue(undefined);
      }
    });

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