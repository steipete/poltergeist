// Tests for BuilderFactory and builders
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BuilderFactory, ExecutableBuilder, AppBundleBuilder } from '../src/builders/index.js';
import { StateManager } from '../src/state.js';
import { Logger } from '../src/logger.js';
import { BaseTarget, ExecutableTarget, AppBundleTarget } from '../src/types.js';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Mock child process
class MockChildProcess extends EventEmitter {
  constructor() {
    super();
  }
}

// Mock modules
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn().mockReturnValue('abc123\n')
}));
vi.mock('../src/notifier.js');
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true)
}));

// Mock logger
const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

// Mock state manager
const mockStateManager: StateManager = {
  updateBuildStatus: vi.fn(),
  updateAppInfo: vi.fn(),
  readState: vi.fn(),
  isLocked: vi.fn(),
  initializeState: vi.fn(),
} as any;

describe('BuilderFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createBuilder', () => {
    it('should create ExecutableBuilder for executable target', () => {
      const target: ExecutableTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/cli',
        watchPaths: ['src/**/*.ts'],
      };

      const builder = BuilderFactory.createBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      expect(builder).toBeInstanceOf(ExecutableBuilder);
    });

    it('should create AppBundleBuilder for app-bundle target', () => {
      const target: AppBundleTarget = {
        name: 'mac-app',
        type: 'app-bundle',
        platform: 'macos',
        enabled: true,
        buildCommand: 'xcodebuild',
        bundleId: 'com.example.app',
        watchPaths: ['src/**/*.swift'],
      };

      const builder = BuilderFactory.createBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      expect(builder).toBeInstanceOf(AppBundleBuilder);
    });

    it('should throw error for unsupported target type', () => {
      const target = {
        name: 'unknown',
        type: 'unsupported-type',
        enabled: true,
        buildCommand: 'echo test',
        watchPaths: ['**/*'],
      } as any;

      expect(() => {
        BuilderFactory.createBuilder(
          target,
          '/test/project',
          mockLogger,
          mockStateManager
        );
      }).toThrow('Unknown target type: unsupported-type');
    });
  });
});

describe('ExecutableBuilder', () => {
  let builder: ExecutableBuilder;
  let target: ExecutableTarget;

  beforeEach(() => {
    vi.clearAllMocks();
    
    target = {
      name: 'cli',
      type: 'executable',
      enabled: true,
      buildCommand: 'npm run build',
      outputPath: './dist/cli',
      watchPaths: ['src/**/*.ts'],
      settlingDelay: 100,
    };

    builder = new ExecutableBuilder(
      target,
      '/test/project',
      mockLogger,
      mockStateManager
    );
  });

  describe('build', () => {
    it('should execute build command successfully', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);
      
      // Mock state manager methods
      vi.mocked(mockStateManager.isLocked).mockResolvedValue(false);
      vi.mocked(mockStateManager.initializeState).mockResolvedValue({} as any);
      vi.mocked(mockStateManager.updateBuildStatus).mockResolvedValue(undefined);
      vi.mocked(mockStateManager.updateAppInfo).mockResolvedValue(undefined);

      // Start the build
      const buildPromise = builder.build(['src/main.ts']);

      // Simulate successful build
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      const result = await buildPromise;

      expect(result.status).toBe('success');
      expect(result.targetName).toBe('cli');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[cli] Building with 1 changed file(s)')
      );
    });

    it('should handle build failure', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);
      
      // Mock state manager methods
      vi.mocked(mockStateManager.isLocked).mockResolvedValue(false);
      vi.mocked(mockStateManager.initializeState).mockResolvedValue({} as any);
      vi.mocked(mockStateManager.updateBuildStatus).mockResolvedValue(undefined);

      // Start the build
      const buildPromise = builder.build(['src/main.ts']);

      // Simulate failed build
      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      const result = await buildPromise;

      expect(result.status).toBe('failure');
      expect(result.error).toContain('Build process exited with code 1');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('[cli] Build failed')
      );
    });

    it('should update state manager on successful build', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);
      
      // Mock state manager methods
      vi.mocked(mockStateManager.isLocked).mockResolvedValue(false);
      vi.mocked(mockStateManager.initializeState).mockResolvedValue({} as any);
      vi.mocked(mockStateManager.updateBuildStatus).mockResolvedValue(undefined);
      vi.mocked(mockStateManager.updateAppInfo).mockResolvedValue(undefined);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate successful build
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      await buildPromise;

      expect(mockStateManager.updateBuildStatus).toHaveBeenCalledWith(
        'cli',
        expect.objectContaining({
          status: 'success',
          targetName: 'cli',
        })
      );

      expect(mockStateManager.updateAppInfo).toHaveBeenCalledWith(
        'cli',
        expect.objectContaining({
          outputPath: '/test/project/dist/cli',
        })
      );
    });

    it('should update state manager on failed build', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);
      
      // Mock state manager methods
      vi.mocked(mockStateManager.isLocked).mockResolvedValue(false);
      vi.mocked(mockStateManager.initializeState).mockResolvedValue({} as any);
      vi.mocked(mockStateManager.updateBuildStatus).mockResolvedValue(undefined);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate failed build
      setTimeout(() => {
        mockProcess.emit('close', 1);
      }, 10);

      await buildPromise;

      expect(mockStateManager.updateBuildStatus).toHaveBeenLastCalledWith(
        'cli',
        expect.objectContaining({
          status: 'failure',
          targetName: 'cli',
          error: expect.stringContaining('Build process exited with code 1'),
        })
      );
    });

    it('should skip build if already in progress', async () => {
      vi.mocked(mockStateManager.isLocked).mockResolvedValue(true);

      const result = await builder.build([]);

      expect(result.status).toBe('building');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[cli] Build already in progress')
      );
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('should validate required fields', async () => {
      const invalidTarget = {
        ...target,
        buildCommand: '',
      };
      
      const invalidBuilder = new ExecutableBuilder(
        invalidTarget,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      await expect(invalidBuilder.validate()).rejects.toThrow(
        'buildCommand is required'
      );
    });
  });
});

describe('AppBundleBuilder', () => {
  let builder: AppBundleBuilder;
  let target: AppBundleTarget;

  beforeEach(() => {
    vi.clearAllMocks();
    
    target = {
      name: 'mac-app',
      type: 'app-bundle',
      platform: 'macos',
      enabled: true,
      buildCommand: 'xcodebuild -scheme MyApp',
      bundleId: 'com.example.myapp',
      watchPaths: ['src/**/*.swift'],
      autoRelaunch: false,
    };

    builder = new AppBundleBuilder(
      target,
      '/test/project',
      mockLogger,
      mockStateManager
    );
  });

  describe('build', () => {
    it('should build macOS app successfully', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);
      
      // Mock state manager methods
      vi.mocked(mockStateManager.isLocked).mockResolvedValue(false);
      vi.mocked(mockStateManager.initializeState).mockResolvedValue({} as any);
      vi.mocked(mockStateManager.updateBuildStatus).mockResolvedValue(undefined);
      vi.mocked(mockStateManager.updateAppInfo).mockResolvedValue(undefined);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate successful build
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      const result = await buildPromise;

      expect(result.status).toBe('success');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[mac-app] Building with 0 changed file(s)')
      );
    });

    it('should extract Xcode error summary', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);
      
      // Mock state manager methods
      vi.mocked(mockStateManager.isLocked).mockResolvedValue(false);
      vi.mocked(mockStateManager.initializeState).mockResolvedValue({} as any);
      vi.mocked(mockStateManager.updateBuildStatus).mockResolvedValue(undefined);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate failed build with error
      setTimeout(() => {
        mockProcess.emit('error', new Error('/Users/test/MyApp/ContentView.swift:42:5: error: cannot find \'unknownFunction\' in scope'));
        mockProcess.emit('close', 1);
      }, 10);

      await buildPromise;

      expect(mockStateManager.updateBuildStatus).toHaveBeenLastCalledWith(
        'mac-app',
        expect.objectContaining({
          status: 'failure',
          errorSummary: expect.stringContaining("error:"),
        })
      );
    });
  });

  describe('auto-relaunch', () => {
    it('should not relaunch if autoRelaunch is false', async () => {
      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);
      
      // Mock state manager methods
      vi.mocked(mockStateManager.isLocked).mockResolvedValue(false);
      vi.mocked(mockStateManager.initializeState).mockResolvedValue({} as any);
      vi.mocked(mockStateManager.updateBuildStatus).mockResolvedValue(undefined);
      vi.mocked(mockStateManager.updateAppInfo).mockResolvedValue(undefined);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate successful build
      setTimeout(() => {
        mockProcess.emit('close', 0);
      }, 10);

      await buildPromise;

      // Check that spawn was only called once (for build, not for relaunch)
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Error Handling', () => {
  it('should handle process spawn errors', async () => {
    const target: ExecutableTarget = {
      name: 'cli',
      type: 'executable',
      enabled: true,
      buildCommand: 'nonexistent-command',
      outputPath: './dist/cli',
      watchPaths: ['src/**/*.ts'],
    };

    const builder = new ExecutableBuilder(
      target,
      '/test/project',
      mockLogger,
      mockStateManager
    );

    const mockProcess = new MockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess as any);
    
    // Mock state manager methods
    vi.mocked(mockStateManager.isLocked).mockResolvedValue(false);
    vi.mocked(mockStateManager.initializeState).mockResolvedValue({} as any);
    vi.mocked(mockStateManager.updateBuildStatus).mockResolvedValue(undefined);

    // Start the build
    const buildPromise = builder.build([]);

    // Simulate spawn error
    setTimeout(() => {
      mockProcess.emit('error', new Error('spawn nonexistent-command ENOENT'));
    }, 10);

    const result = await buildPromise;

    expect(result.status).toBe('failure');
    expect(result.error).toContain('spawn nonexistent-command ENOENT');
  });
});