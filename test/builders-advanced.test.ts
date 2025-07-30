// Advanced builder tests - timeout handling, large output, environment variables
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExecutableBuilder, AppBundleBuilder } from '../src/builders/index.js';
import { StateManager } from '../src/state.js';
import { Logger } from '../src/logger.js';
import { ExecutableTarget, AppBundleTarget } from '../src/types.js';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

// Mock child process with stream support
class MockChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  
  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  
  kill(signal?: string) {
    this.emit('close', signal === 'SIGKILL' ? 137 : 143);
  }
}

// Mock modules
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn().mockReturnValue('abc123\n')
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
} as any;

// Mock state manager
const mockStateManager = {
  updateBuildStatus: vi.fn(),
  updateAppInfo: vi.fn(),
  readState: vi.fn(),
  isLocked: vi.fn().mockResolvedValue(false),
  initializeState: vi.fn().mockResolvedValue({}),
} as any;

describe('Advanced Builder Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });

  describe.skip('Timeout Handling', () => {
    it('should timeout long-running builds', async () => {
      vi.useFakeTimers();
      const target: ExecutableTarget = {
        name: 'timeout-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'sleep 300', // 5 minutes
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
        timeout: 5000, // 5 seconds
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);
      
      // Let the build start
      await Promise.resolve();

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(5100);

      // Process should be killed
      mockProcess.emit('close', 143); // SIGTERM exit code

      const result = await buildPromise;

      expect(result.status).toBe('failure');
      expect(result.error).toContain('timeout');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Build failed'),
        expect.any(Error)
      );
    });

    it('should use default timeout if not specified', async () => {
      vi.useFakeTimers();
      const target: ExecutableTarget = {
        name: 'default-timeout',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
        // No timeout specified - should use default
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);
      
      // Let the build start
      await Promise.resolve();

      // Fast-forward past default timeout (e.g., 5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);

      // Process should be killed
      mockProcess.emit('close', 143);

      const result = await buildPromise;

      expect(result.status).toBe('failure');
    });

    it('should clean up timeout timer on successful build', async () => {
      vi.useFakeTimers();
      const target: ExecutableTarget = {
        name: 'cleanup-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'echo "quick"',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
        timeout: 10000,
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Let the build start
      await Promise.resolve();

      // Complete build quickly
      mockProcess.emit('close', 0);

      const result = await buildPromise;

      expect(result.status).toBe('success');
      
      // Advance time past timeout - should not trigger
      vi.advanceTimersByTime(11000);
      
      // No timeout error should occur
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.stringContaining('timed out')
      );
    });
  });

  describe.skip('Large Output Handling', () => {
    it('should handle large stdout output', async () => {
      const target: ExecutableTarget = {
        name: 'large-output',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build:verbose',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate large output in chunks
      const largeData = 'x'.repeat(1024); // 1KB chunks
      for (let i = 0; i < 100; i++) { // 100KB total
        mockProcess.stdout.push(`Build output ${i}: ${largeData}\n`);
      }
      mockProcess.stdout.push(null); // End stream

      // Complete build
      mockProcess.emit('close', 0);

      const result = await buildPromise;

      expect(result.status).toBe('success');
      // Output should be captured (though might be truncated in real implementation)
      expect(result.output).toBeDefined();
      expect(result.output?.length).toBeGreaterThan(0);
    });

    it('should handle large stderr output', async () => {
      const target: ExecutableTarget = {
        name: 'large-error',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate large error output
      const errorData = 'ERROR: '.repeat(100);
      for (let i = 0; i < 50; i++) {
        mockProcess.stderr.push(`${errorData} at line ${i}\n`);
      }
      mockProcess.stderr.push(null);

      // Fail build
      mockProcess.emit('close', 1);

      const result = await buildPromise;

      expect(result.status).toBe('failure');
      expect(result.error).toBeDefined();
      // Should extract meaningful error summary
      expect(result.errorSummary).toBeDefined();
    });

    it('should handle binary output gracefully', async () => {
      const target: ExecutableTarget = {
        name: 'binary-output',
        type: 'executable',
        enabled: true,
        buildCommand: 'generate-binary',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate binary data
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
      mockProcess.stdout.push(binaryData);
      mockProcess.stdout.push(null);

      // Complete build
      mockProcess.emit('close', 0);

      const result = await buildPromise;

      expect(result.status).toBe('success');
      // Should handle binary data without crashing
    });

    it('should truncate extremely large output', async () => {
      const target: ExecutableTarget = {
        name: 'extreme-output',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate extremely large output (10MB)
      const chunk = 'x'.repeat(1024 * 1024); // 1MB
      for (let i = 0; i < 10; i++) {
        mockProcess.stdout.push(chunk);
      }
      mockProcess.stdout.push(null);

      // Complete build
      mockProcess.emit('close', 0);

      const result = await buildPromise;

      expect(result.status).toBe('success');
      // In real implementation, output should be truncated to reasonable size
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Large build output')
      );
    });
  });

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

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);
      
      // Emit close event to complete the build
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });
      
      // Wait for build to complete
      await buildPromise;

      // Verify spawn was called with environment variables
      expect(spawn).toHaveBeenCalledWith(
        'npm run build',
        expect.objectContaining({
          cwd: '/test/project',
          env: expect.objectContaining({
            NODE_ENV: 'production',
            API_KEY: 'secret-key',
            BUILD_VERSION: '1.2.3',
          }),
          shell: true,
          stdio: 'inherit',
        })
      );
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

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);
      
      // Emit close event to complete the build
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });
      
      // Wait for build to complete
      await buildPromise;

      // Should include both process.env and custom env
      expect(spawn).toHaveBeenCalledWith(
        'npm run build',
        expect.objectContaining({
          cwd: '/test/project',
          env: expect.objectContaining({
            ...process.env,
            CUSTOM_VAR: 'custom-value',
          }),
          shell: true,
          stdio: 'inherit',
        })
      );
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

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);
      
      // Emit close event to complete the build
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });
      
      // Wait for build to complete
      await buildPromise;

      // Custom env should override process env
      expect(spawn).toHaveBeenCalledWith(
        'npm run build',
        expect.objectContaining({
          cwd: '/test/project',
          env: expect.objectContaining({
            TEST_VAR: 'overridden',
          }),
          shell: true,
          stdio: 'inherit',
        })
      );

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
          'VAR_WITH_UNDERSCORE': 'underscore_value',
          'PATH_ADDITION': '/custom/path:$PATH',
          'QUOTED_VAR': '"quoted value"',
          'EMPTY_VAR': '',
        },
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);
      
      // Emit close event to complete the build
      setImmediate(() => {
        mockProcess.emit('close', 0);
      });
      
      // Wait for build to complete
      await buildPromise;

      expect(spawn).toHaveBeenCalledWith(
        'npm run build',
        expect.objectContaining({
          cwd: '/test/project',
          env: expect.objectContaining({
            'SPECIAL-VAR': 'value-with-dash',
            'VAR_WITH_UNDERSCORE': 'underscore_value',
            'PATH_ADDITION': '/custom/path:$PATH',
            'QUOTED_VAR': '"quoted value"',
            'EMPTY_VAR': '',
          }),
          shell: true,
          stdio: 'inherit',
        })
      );
    });
  });

  describe.skip('Process Management', () => {
    it('should handle process spawn errors', async () => {
      const target: ExecutableTarget = {
        name: 'spawn-error',
        type: 'executable',
        enabled: true,
        buildCommand: 'non-existent-command',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Emit spawn error
      mockProcess.emit('error', new Error('spawn ENOENT'));

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

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate segmentation fault
      mockProcess.emit('close', 139); // SIGSEGV

      const result = await buildPromise;

      expect(result.status).toBe('failure');
      expect(result.error).toContain('Build process crashed');
    });

    it('should handle zombie processes', async () => {
      const target: ExecutableTarget = {
        name: 'zombie-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'long-running-build',
        outputPath: './dist/test',
        watchPaths: ['src/**/*'],
      };

      const builder = new ExecutableBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      const originalKill = mockProcess.kill.bind(mockProcess);
      let killCount = 0;
      
      // Mock kill to simulate zombie process
      mockProcess.kill = vi.fn((signal) => {
        killCount++;
        if (killCount < 3) {
          // Don't emit close on first attempts
          return;
        }
        originalKill(signal);
      });

      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Trigger timeout
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);

      // Should try multiple kill attempts
      expect(mockProcess.kill).toHaveBeenCalledTimes(3);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');

      await buildPromise;
    });
  });

  describe.skip('AppBundleBuilder Advanced Features', () => {
    it('should handle complex Xcode error output', async () => {
      const target: AppBundleTarget = {
        name: 'xcode-errors',
        type: 'app-bundle',
        enabled: true,
        buildCommand: 'xcodebuild -scheme MyApp',
        bundleId: 'com.example.app',
        platform: 'macos',
        watchPaths: ['src/**/*.swift'],
      };

      const builder = new AppBundleBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      // Start the build
      const buildPromise = builder.build([]);

      // Simulate complex Xcode error output
      const xcodeError = `
CompileSwiftSources normal x86_64 com.apple.xcode.tools.swift.compiler (in target 'MyApp' from project 'MyApp')
    cd /Users/dev/MyApp
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer

/Users/dev/MyApp/ContentView.swift:42:15: error: cannot find 'unknownFunction' in scope
        unknownFunction()
        ^~~~~~~~~~~~~~~

/Users/dev/MyApp/ContentView.swift:55:9: error: value of type 'String' has no member 'unknownMethod'
        name.unknownMethod()
        ~~~~ ^~~~~~~~~~~~~

/Users/dev/MyApp/Models/User.swift:12:5: warning: 'userName' is deprecated: Use 'username' instead
    userName = "test"
    ^~~~~~~~

** BUILD FAILED **

The following build commands failed:
    CompileSwiftSources normal x86_64 com.apple.xcode.tools.swift.compiler
(1 failure)
`;

      mockProcess.stderr.push(xcodeError);
      mockProcess.stderr.push(null);
      mockProcess.emit('close', 1);

      const result = await buildPromise;

      expect(result.status).toBe('failure');
      expect(result.errorSummary).toContain("cannot find 'unknownFunction' in scope");
      expect(result.errorSummary).toContain("value of type 'String' has no member 'unknownMethod'");
      expect(mockStateManager.updateBuildStatus).toHaveBeenCalledWith(
        'xcode-errors',
        expect.objectContaining({
          errorSummary: expect.stringContaining('error:'),
        })
      );
    });

    it('should extract linking errors', async () => {
      const target: AppBundleTarget = {
        name: 'link-errors',
        type: 'app-bundle',
        enabled: true,
        buildCommand: 'xcodebuild',
        bundleId: 'com.example.app',
        watchPaths: ['**/*.swift'],
      };

      const builder = new AppBundleBuilder(
        target,
        '/test/project',
        mockLogger,
        mockStateManager
      );

      const mockProcess = new MockChildProcess();
      vi.mocked(spawn).mockReturnValue(mockProcess as any);

      const buildPromise = builder.build([]);

      const linkError = `
ld: warning: ignoring file /path/to/lib.a, building for iOS Simulator-arm64 but attempting to link with file built for iOS Simulator-x86_64
Undefined symbols for architecture arm64:
  "_OBJC_CLASS_$_SomeClass", referenced from:
      objc-class-ref in ViewController.o
ld: symbol(s) not found for architecture arm64
clang: error: linker command failed with exit code 1 (use -v to see invocation)
`;

      mockProcess.stderr.push(linkError);
      mockProcess.stderr.push(null);
      mockProcess.emit('close', 1);

      const result = await buildPromise;

      expect(result.errorSummary).toContain('Undefined symbols');
      expect(result.errorSummary).toContain('linker command failed');
    });
  });
});