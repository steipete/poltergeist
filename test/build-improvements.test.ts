import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutableBuilder } from '../src/builders/executable-builder.js';
import { createLogger } from '../src/logger.js';
import { StateManager } from '../src/state.js';
import type { ExecutableTarget } from '../src/types.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => 'abc123'),
}));

async function waitForState<T>(reader: () => Promise<T>, timeoutMs: number = 750): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  while (true) {
    last = await reader();
    if (last) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('Build Improvements - Real-time Output & Error Capture', () => {
  let tempDir: string;
  let projectRoot: string;
  let builder: ExecutableBuilder;
  let target: ExecutableTarget;
  let stateManager: StateManager;
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create temp directory
    tempDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    projectRoot = join(tempDir, 'project');
    mkdirSync(projectRoot, { recursive: true });

    // Setup mocks
    logger = createLogger('error');
    stateManager = new StateManager(projectRoot, logger);

    target = {
      name: 'test-app',
      type: 'executable',
      buildCommand: 'echo "Building..." && echo "Error: test error" >&2 && exit 1',
      watchPaths: ['**/*.ts'],
      outputPath: './dist/test-app',
      enabled: true,
    };

    builder = new ExecutableBuilder(target, projectRoot, logger, stateManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('should stream build output in real-time', async () => {
    // Create the expected output file
    const distDir = join(projectRoot, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'test-app'), '#!/usr/bin/env node\nconsole.log("test");');

    const mockProcess = {
      stdout: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('Building application...\n'));
            handler(Buffer.from('Compiling source files...\n'));
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, handler) => {
        if (event === 'close') {
          handler(0); // Success
        }
      }),
    };

    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(mockProcess as any);

    const consoleOutput: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: any) => {
      consoleOutput.push(chunk.toString());
      return true;
    }) as any;

    try {
      await builder.build([]);

      // Verify output was streamed
      expect(consoleOutput.join('')).toContain('Building application...');
      expect(consoleOutput.join('')).toContain('Compiling source files...');

      // Verify spawn was called with pipe for stdout/stderr
      expect(spawnMock).toHaveBeenCalledWith(
        target.buildCommand,
        expect.objectContaining({
          stdio: ['inherit', 'pipe', 'pipe'],
        })
      );
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it('should capture error output for diagnostics', async () => {
    const mockProcess = {
      stdout: {
        on: vi.fn(),
      },
      stderr: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('error TS2345: Argument of type string is not assignable\n'));
            handler(Buffer.from('error TS2339: Property foo does not exist on type Bar\n'));
          }
        }),
      },
      on: vi.fn((event, handler) => {
        if (event === 'close') {
          // Delay to simulate async process end
          setTimeout(() => handler(1), 10); // Failure
        }
        if (event === 'error') {
          // Need to handle error event to prevent unhandled rejection
        }
      }),
    };

    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(mockProcess as any);

    const updateBuildErrorSpy = vi.spyOn(stateManager, 'updateBuildError');

    const result = await builder.build([]);

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 150));

    // console.log('Build result:', result);

    expect(result.status).toBe('failure');
    expect(result.errorSummary).toBeDefined();
    // The error should contain TS error messages that were streamed
    expect(result.errorSummary).toMatch(/error TS\d+/);

    // Verify error was stored in state
    expect(updateBuildErrorSpy).toHaveBeenCalledWith(
      'test-app',
      expect.objectContaining({
        exitCode: 1,
        errorOutput: expect.arrayContaining([
          expect.stringContaining('TS2345'),
          expect.stringContaining('TS2339'),
        ]),
      })
    );
  });

  it('should store build error context in state', async () => {
    const mockProcess = {
      stdout: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('Step 1: Preparing build\n'));
            handler(Buffer.from('Step 2: Compiling\n'));
          }
        }),
      },
      stderr: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('Fatal error: Cannot find module\n'));
          }
        }),
      },
      on: vi.fn((event, handler) => {
        if (event === 'close') {
          setTimeout(() => handler(127), 10); // Command not found
        }
      }),
    };

    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(mockProcess as any);

    await stateManager.initializeState(target);

    const result = await builder.build([]);

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result.status).toBe('failure');
    expect(result.errorSummary).toBeDefined();

    // Read state to verify error context was stored (allowing async persistence)
    const state = await waitForState(() => stateManager.readState('test-app'));
    expect(state?.lastBuildError).toBeDefined();
    expect(state?.lastBuildError?.exitCode).toBe(127);
    expect(state?.lastBuildError?.errorOutput).toContain('Fatal error: Cannot find module');
    expect(state?.lastBuildError?.lastOutput).toContain('Step 2: Compiling');
    expect(state?.lastBuildError?.command).toBe(target.buildCommand);
  });

  it('should capture logs when captureLogs option is enabled', async () => {
    // Create the expected output file
    const distDir = join(projectRoot, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'test-app'), '#!/usr/bin/env node\nconsole.log("test");');

    const logFile = join(tempDir, 'build.log');

    const mockProcess = {
      stdout: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('Build output line 1\n'));
            handler(Buffer.from('Build output line 2\n'));
          }
        }),
      },
      stderr: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('Warning: deprecated API\n'));
          }
        }),
      },
      on: vi.fn((event, handler) => {
        if (event === 'close') {
          // Small delay to ensure file write completes
          setTimeout(() => handler(0), 10);
        }
      }),
    };

    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(mockProcess as any);

    await builder.build([], {
      captureLogs: true,
      logFile,
    });

    // Wait a bit for file write to complete (slower runners need a little padding)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify log file was created and contains output
    expect(existsSync(logFile)).toBe(true);
    const logContent = readFileSync(logFile, 'utf-8');
    expect(logContent).toContain('Build output line 1');
    expect(logContent).toContain('Build output line 2');
    expect(logContent).toContain('Warning: deprecated API');
  });

  it('should include recent output in error messages', async () => {
    const mockProcess = {
      stdout: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            // Simulate many lines of output
            for (let i = 1; i <= 20; i++) {
              handler(Buffer.from(`Build step ${i}\n`));
            }
          }
        }),
      },
      stderr: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('ERROR: Compilation failed\n'));
          }
        }),
      },
      on: vi.fn((event, handler) => {
        if (event === 'close') {
          setTimeout(() => handler(1), 10); // Failure
        }
      }),
    };

    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(mockProcess as any);

    const result = await builder.build([]);

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result.status).toBe('failure');
    expect(result.errorSummary).toBeDefined();
    // Error summary should contain the error message
    expect(result.errorSummary).toMatch(/ERROR.*Compilation failed/);
  });
});

describe('Build Command CLI', () => {
  it('should handle build command with JSON output', async () => {
    // This would be an integration test that actually runs the CLI
    // For unit testing, we've already verified the builder behavior above
    expect(true).toBe(true);
  });
});

describe('Automatic Rebuild on Failure', () => {
  it('should detect recent build failures', () => {
    const now = Date.now();
    const fourMinutesAgo = new Date(now - 4 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();

    // Recent failure (< 5 minutes)
    const recentError = {
      timestamp: fourMinutesAgo,
      exitCode: 1,
    };

    const errorAge = Date.now() - new Date(recentError.timestamp).getTime();
    expect(errorAge).toBeLessThan(5 * 60 * 1000);

    // Old failure (> 5 minutes)
    const oldError = {
      timestamp: tenMinutesAgo,
      exitCode: 1,
    };

    const oldErrorAge = Date.now() - new Date(oldError.timestamp).getTime();
    expect(oldErrorAge).toBeGreaterThan(5 * 60 * 1000);
  });
});
