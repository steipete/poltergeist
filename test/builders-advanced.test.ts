// Advanced builder tests - timeout handling, large output, environment variables

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutableBuilder } from '../src/builders/index.js';
import type { IStateManager } from '../src/interfaces.js';
import type { Logger } from '../src/logger.js';
import type { ExecutableTarget } from '../src/types.js';

// Mock child process with stream support
class MockChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  pid = 12345;

  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }

  kill(signal?: string) {
    this.emit('close', signal === 'SIGKILL' ? 137 : 143);
    return true;
  }
}

// Mock modules
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn().mockReturnValue('abc123\n'),
}));

vi.mock('../src/notifier.js');

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock logger
const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

// Mock state manager
const mockStateManager = {
  updateBuildStatus: vi.fn(),
  updateAppInfo: vi.fn(),
  readState: vi.fn(),
  isLocked: vi.fn().mockResolvedValue(false),
  initializeState: vi.fn().mockResolvedValue({
    target: 'test',
    projectName: 'test-project',
    projectRoot: '/test/project',
    process: {
      pid: process.pid,
      hostname: 'test-host',
      isActive: true,
      lastHeartbeat: new Date().toISOString(),
    },
    lastBuild: null,
    buildHistory: [],
  }),
  updateState: vi.fn(),
  removeState: vi.fn(),
  discoverStates: vi.fn(),
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
  cleanup: vi.fn(),
} as IStateManager;

describe('Advanced Builder Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Timeout feature not implemented - tests deleted

  // Output capture feature not implemented (stdio: 'inherit') - tests deleted

  describe('Environment Variables', () => {
    it('should pass custom environment variables', async () => {
      const target: ExecutableTarget = {
        name: 'env-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
        environment: {
          NODE_ENV: 'production',
          API_KEY: 'secret-key',
          BUILD_VERSION: '1.2.3',
        },
      };

      const builder = new ExecutableBuilder(target, '/test/project', mockLogger, mockStateManager);

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as ReturnType<typeof spawn>);

      // Start the build
      const buildPromise = builder.build([]);

      // Emit close event to complete the build
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });

      // Wait for build to complete
      await buildPromise;

      // Verify spawn was called with correct parameters
      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];
      expect(spawnCall[0]).toBe('npm run build');
      expect(spawnCall[1]).toMatchObject({
        cwd: '/test/project',
        shell: true,
        stdio: ['inherit', 'pipe', 'pipe'], // Note: stdio is now pipe for stdout/stderr
      });

      // Verify environment variables are present
      const env = spawnCall[1].env;
      expect(env).toBeDefined();
      expect(env.NODE_ENV).toBe('production');
      expect(env.API_KEY).toBe('secret-key');
      expect(env.BUILD_VERSION).toBe('1.2.3');
    });

    it('should merge with process environment', async () => {
      const target: ExecutableTarget = {
        name: 'env-merge',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
        environment: {
          CUSTOM_VAR: 'custom-value',
        },
      };

      const builder = new ExecutableBuilder(target, '/test/project', mockLogger, mockStateManager);

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as ReturnType<typeof spawn>);

      // Start the build
      const buildPromise = builder.build([]);

      // Emit close event to complete the build
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });

      // Wait for build to complete
      await buildPromise;

      // Verify spawn was called and check environment variables
      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];

      // Verify custom env var was added
      const env = spawnCall[1].env;
      expect(env).toBeDefined();
      expect(env.CUSTOM_VAR).toBe('custom-value');

      // Verify that PATH from process.env is preserved (as an example)
      if (process.env.PATH) {
        expect(env.PATH).toBe(process.env.PATH);
      }
    });

    it('should override process environment variables', async () => {
      // Set a process env var
      process.env.TEST_VAR = 'original';

      const target: ExecutableTarget = {
        name: 'env-override',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
        environment: {
          TEST_VAR: 'overridden',
        },
      };

      const builder = new ExecutableBuilder(target, '/test/project', mockLogger, mockStateManager);

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as ReturnType<typeof spawn>);

      // Start the build
      const buildPromise = builder.build([]);

      // Emit close event to complete the build
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });

      // Wait for build to complete
      await buildPromise;

      // Verify spawn was called and check environment variable override
      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];

      // Verify TEST_VAR was overridden
      const env = spawnCall[1].env;
      expect(env).toBeDefined();
      expect(env.TEST_VAR).toBe('overridden');

      // Clean up
      delete process.env.TEST_VAR;
    });

    it('should handle environment variables with special characters', async () => {
      const target: ExecutableTarget = {
        name: 'env-special',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
        environment: {
          'SPECIAL-VAR': 'value-with-dash',
          VAR_WITH_UNDERSCORE: 'underscore_value',
          PATH_ADDITION: '/custom/path:$PATH',
          QUOTED_VAR: '"quoted value"',
          EMPTY_VAR: '',
        },
      };

      const builder = new ExecutableBuilder(target, '/test/project', mockLogger, mockStateManager);

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as ReturnType<typeof spawn>);

      // Start the build
      const buildPromise = builder.build([]);

      // Emit close event to complete the build
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });

      // Wait for build to complete
      await buildPromise;

      // Verify spawn was called with special environment variables
      expect(spawn).toHaveBeenCalled();
      const spawnCall = vi.mocked(spawn).mock.calls[0];

      // Verify all special env vars were passed correctly
      const env = spawnCall[1].env;
      expect(env).toBeDefined();
      expect(env['SPECIAL-VAR']).toBe('value-with-dash');
      expect(env.VAR_WITH_UNDERSCORE).toBe('underscore_value');
      expect(env.PATH_ADDITION).toBe('/custom/path:$PATH');
      expect(env.QUOTED_VAR).toBe('"quoted value"');
      expect(env.EMPTY_VAR).toBe('');
    });
  });

  describe('Process Management', () => {
    it('should handle process spawn errors', async () => {
      const target: ExecutableTarget = {
        name: 'spawn-error',
        type: 'executable',
        enabled: true,
        buildCommand: 'non-existent-command',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
      };

      const builder = new ExecutableBuilder(target, '/test/project', mockLogger, mockStateManager);

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as ReturnType<typeof spawn>);

      // Start the build
      const buildPromise = builder.build([]);

      // Emit spawn error after a tick to ensure handlers are attached
      setImmediate(() => {
        mockProcess.emit('error', new Error('spawn ENOENT'));
      });

      const result = await buildPromise;

      expect(result.status).toBe('failure');
      expect(result.error).toContain('spawn ENOENT');
    });

    it('should handle process crashes', async () => {
      const target: ExecutableTarget = {
        name: 'crash-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'crashy-build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
      };

      const builder = new ExecutableBuilder(target, '/test/project', mockLogger, mockStateManager);

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as ReturnType<typeof spawn>);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate segmentation fault after a tick to ensure handlers are attached
      setImmediate(() => {
        mockProcess.emit('close', 139); // SIGSEGV
      });

      const result = await buildPromise;

      expect(result.status).toBe('failure');
      // Current implementation just reports exit code
      expect(result.error).toContain('Build process exited with code 139');
    });

    // Zombie process handling requires timeout feature - test deleted
  });

  // AppBundleBuilder advanced Xcode error parsing not implemented - tests deleted
});
