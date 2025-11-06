import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/logger.js';
import { ExecutableRunner } from '../../src/runners/executable-runner.js';
import type { ExecutableTarget } from '../../src/types.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

const { spawn } = await import('child_process');

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    success: vi.fn(),
  } as unknown as Logger;
}

describe('ExecutableRunner', () => {
  let projectRoot: string;
  let target: ExecutableTarget;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'poltergeist-runner-'));
    mkdirSync(join(projectRoot, 'dist'), { recursive: true });
    const binaryPath = join(projectRoot, 'dist', 'app');
    writeFileSync(binaryPath, '');

    target = {
      name: 'app',
      type: 'executable',
      buildCommand: 'echo build',
      outputPath: './dist/app',
      watchPaths: ['src/**/*.go'],
      autoRun: {
        enabled: true,
        restartDelayMs: 100,
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('launches the binary after first successful build', async () => {
    const listeners: Record<string, (...args: any[]) => void> = {};
    (spawn as vi.Mock).mockImplementation(() => ({
      on: (event: string, handler: (...args: any[]) => void) => {
        listeners[event] = handler;
        return this;
      },
      once: (event: string, handler: (...args: any[]) => void) => {
        listeners[event] = handler;
        return this;
      },
      removeListener: vi.fn((event: string) => {
        delete listeners[event];
        return this;
      }),
      kill: vi.fn(),
      exitCode: null,
      signalCode: null,
      killed: false,
    }));

    const runner = new ExecutableRunner(target, { projectRoot, logger: makeLogger() });
    await runner.onBuildSuccess();

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args] = (spawn as vi.Mock).mock.calls[0];
    expect(command).toBe(join(projectRoot, 'dist', 'app'));
    expect(args).toEqual([]);

    // Simulate exit to avoid dangling listeners
    listeners.exit?.(0, null);
  });

  it('restarts the process after subsequent successful build', async () => {
    vi.useFakeTimers();
    const killMocks: Array<ReturnType<typeof vi.fn>> = [];

    (spawn as vi.Mock).mockImplementation(() => {
      const listeners: Record<string, (...args: any[]) => void> = {};
      const kill = vi.fn((signal: NodeJS.Signals) => {
        listeners.exit?.(0, signal);
        return true;
      });
      killMocks.push(kill);
      return {
        on: (event: string, handler: (...args: any[]) => void) => {
          listeners[event] = handler;
          return this;
        },
        once: (event: string, handler: (...args: any[]) => void) => {
          listeners[event] = handler;
          return this;
        },
        removeListener: vi.fn((event: string) => {
          delete listeners[event];
          return this;
        }),
        kill,
        exitCode: null,
        signalCode: null,
        killed: false,
      };
    });

    const runner = new ExecutableRunner(target, { projectRoot, logger: makeLogger() });
    await runner.onBuildSuccess();
    expect(spawn).toHaveBeenCalledTimes(1);

    await runner.onBuildSuccess();
    await vi.advanceTimersByTimeAsync(150);
    await vi.waitFor(() => {
      expect(killMocks[0]).toHaveBeenCalledWith('SIGINT');
      expect(spawn).toHaveBeenCalledTimes(2);
    });

    vi.useRealTimers();
  });

  it('stops the process gracefully', async () => {
    const listeners: Record<string, (...args: any[]) => void> = {};
    const killMock = vi.fn(() => {
      listeners.exit?.(0, null);
      return true;
    });
    (spawn as vi.Mock).mockImplementation(() => ({
      on: (event: string, handler: (...args: any[]) => void) => {
        listeners[event] = handler;
        return this;
      },
      once: (event: string, handler: (...args: any[]) => void) => {
        listeners[event] = handler;
        return this;
      },
      removeListener: vi.fn((event: string) => {
        delete listeners[event];
        return this;
      }),
      kill: killMock,
      exitCode: null,
      signalCode: null,
      killed: false,
    }));

    const runner = new ExecutableRunner(target, { projectRoot, logger: makeLogger() });
    await runner.onBuildSuccess();
    await runner.stop();

    expect(killMock).toHaveBeenCalledWith('SIGTERM');
  });
});
