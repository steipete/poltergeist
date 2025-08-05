import { fork } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonManager } from '../dist/daemon/daemon-manager.js';
import { createLogger } from '../dist/logger.js';
import type { PoltergeistConfig } from '../dist/types.js';
import { FileSystemUtils } from '../dist/utils/filesystem.js';

// Mock child_process.fork
vi.mock('child_process', () => ({
  fork: vi.fn(),
}));

describe('DaemonManager', () => {
  let daemon: DaemonManager;
  let logger: ReturnType<typeof createLogger>;
  let testProjectPath: string;
  let stateDir: string;

  beforeEach(() => {
    logger = createLogger();
    daemon = new DaemonManager(logger);
    testProjectPath = '/test/project';
    stateDir = FileSystemUtils.getStateDirectory();

    // Clear any existing mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any test files
    const hash = FileSystemUtils.getProjectHash(testProjectPath);
    const daemonInfoPath = join(stateDir, `${hash}-daemon.json`);
    const logFilePath = join(stateDir, `${hash}-daemon.log`);

    try {
      if (existsSync(daemonInfoPath)) {
        await rm(daemonInfoPath);
      }
      if (existsSync(logFilePath)) {
        await rm(logFilePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('isDaemonRunning', () => {
    it('should return false when no daemon info file exists', async () => {
      const result = await daemon.isDaemonRunning(testProjectPath);
      expect(result).toBe(false);
    });

    it('should return false when daemon info exists but process is dead', async () => {
      const hash = FileSystemUtils.getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${hash}-daemon.json`);

      // Create daemon info with non-existent PID
      const daemonInfo = {
        pid: 99999999, // Very unlikely to be a real PID
        startTime: new Date().toISOString(),
        logFile: join(stateDir, `${hash}-daemon.log`),
        projectPath: testProjectPath,
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      const result = await daemon.isDaemonRunning(testProjectPath);
      expect(result).toBe(false);

      // Verify stale info was cleaned up
      expect(existsSync(daemonInfoPath)).toBe(false);
    });

    it('should return true when daemon is actually running', async () => {
      const hash = FileSystemUtils.getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${hash}-daemon.json`);

      // Create daemon info with current process PID (which is definitely running)
      const daemonInfo = {
        pid: process.pid,
        startTime: new Date().toISOString(),
        logFile: join(stateDir, `${hash}-daemon.log`),
        projectPath: testProjectPath,
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      const result = await daemon.isDaemonRunning(testProjectPath);
      expect(result).toBe(true);
    });
  });

  describe('startDaemon', () => {
    it('should successfully start a daemon', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test',
            type: 'executable',
            buildCommand: 'echo test',
            outputPath: './test',
            watchPaths: ['*.ts'],
          },
        ],
      };

      // Mock the fork function
      const mockChild = {
        pid: 12345,
        once: vi.fn((event, callback) => {
          if (event === 'message') {
            // Simulate successful startup message
            setTimeout(() => callback({ type: 'started', pid: 12345 }), 10);
          }
        }),
        unref: vi.fn(),
        disconnect: vi.fn(),
        kill: vi.fn(),
      };

      (fork as any).mockReturnValue(mockChild);

      const pid = await daemon.startDaemon(config, {
        projectRoot: testProjectPath,
        verbose: false,
      });

      expect(pid).toBe(12345);
      expect(fork).toHaveBeenCalledWith(
        expect.stringContaining('daemon-worker.js'),
        expect.any(Array),
        expect.objectContaining({
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        })
      );

      // Verify daemon info was saved
      const hash = FileSystemUtils.getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${hash}-daemon.json`);
      const savedInfo = JSON.parse(await readFile(daemonInfoPath, 'utf-8'));

      expect(savedInfo.pid).toBe(12345);
      expect(savedInfo.projectPath).toBe(testProjectPath);
    });

    it('should fail if daemon is already running', async () => {
      // Set up existing daemon
      const hash = FileSystemUtils.getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${hash}-daemon.json`);

      const daemonInfo = {
        pid: process.pid,
        startTime: new Date().toISOString(),
        logFile: join(stateDir, `${hash}-daemon.log`),
        projectPath: testProjectPath,
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      await expect(
        daemon.startDaemon(config, {
          projectRoot: testProjectPath,
        })
      ).rejects.toThrow('Daemon already running for this project');
    });

    it('should handle daemon startup failure', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Mock fork to simulate error
      const mockChild = {
        once: vi.fn((event, callback) => {
          if (event === 'message') {
            setTimeout(() => callback({ type: 'error', error: 'Startup failed' }), 10);
          }
        }),
        kill: vi.fn(),
      };

      (fork as any).mockReturnValue(mockChild);

      await expect(
        daemon.startDaemon(config, {
          projectRoot: testProjectPath,
        })
      ).rejects.toThrow('Startup failed');
    });

    it('should handle daemon startup timeout', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Mock fork to never send message
      const mockChild = {
        once: vi.fn(),
        kill: vi.fn(),
      };

      (fork as any).mockReturnValue(mockChild);

      // Use fake timers for this test
      vi.useFakeTimers();

      const startPromise = daemon.startDaemon(config, {
        projectRoot: testProjectPath,
      });

      // Fast-forward past timeout
      vi.advanceTimersByTime(11000);

      await expect(startPromise).rejects.toThrow('Daemon startup timeout');
      expect(mockChild.kill).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('stopDaemon', () => {
    it('should successfully stop a running daemon', async () => {
      const hash = FileSystemUtils.getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${hash}-daemon.json`);

      // Create daemon info
      const daemonInfo = {
        pid: 12345,
        startTime: new Date().toISOString(),
        logFile: join(stateDir, `${hash}-daemon.log`),
        projectPath: testProjectPath,
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      // Mock process.kill to simulate successful termination
      const originalKill = process.kill;
      process.kill = vi.fn((pid, signal) => {
        if (signal === 0) {
          // Check if process exists
          return true;
        } else if (signal === 'SIGTERM') {
          // Simulate termination
          return true;
        }
        return true;
      }) as any;

      // Mock waitForProcessExit
      vi.spyOn(daemon as any, 'waitForProcessExit').mockResolvedValue(undefined);

      await daemon.stopDaemon(testProjectPath);

      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
      expect(existsSync(daemonInfoPath)).toBe(false);

      process.kill = originalKill;
    });

    it('should throw error if no daemon is running', async () => {
      await expect(daemon.stopDaemon(testProjectPath)).rejects.toThrow(
        'No daemon running for this project'
      );
    });
  });

  describe('readLogFile', () => {
    it('should return empty array when log file does not exist', async () => {
      const logs = await daemon.readLogFile(testProjectPath);
      expect(logs).toEqual([]);
    });

    it('should read and return log lines', async () => {
      const hash = FileSystemUtils.getProjectHash(testProjectPath);
      const logFilePath = join(stateDir, `${hash}-daemon.log`);

      const logContent = `Line 1
Line 2
Line 3
Line 4
Line 5`;

      await mkdir(stateDir, { recursive: true });
      await writeFile(logFilePath, logContent);

      const logs = await daemon.readLogFile(testProjectPath);
      expect(logs).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5']);
    });

    it('should limit returned lines when specified', async () => {
      const hash = FileSystemUtils.getProjectHash(testProjectPath);
      const logFilePath = join(stateDir, `${hash}-daemon.log`);

      const logContent = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n');

      await mkdir(stateDir, { recursive: true });
      await writeFile(logFilePath, logContent);

      const logs = await daemon.readLogFile(testProjectPath, 3);
      expect(logs).toEqual(['Line 8', 'Line 9', 'Line 10']);
    });
  });

  describe('getDaemonInfo', () => {
    it('should return null when no daemon info exists', async () => {
      const info = await daemon.getDaemonInfo(testProjectPath);
      expect(info).toBeNull();
    });

    it('should return daemon info when daemon is running', async () => {
      const hash = FileSystemUtils.getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${hash}-daemon.json`);

      const daemonInfo = {
        pid: process.pid,
        startTime: '2024-01-01T00:00:00.000Z',
        logFile: join(stateDir, `${hash}-daemon.log`),
        projectPath: testProjectPath,
        configPath: '/test/config.json',
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      const info = await daemon.getDaemonInfo(testProjectPath);
      expect(info).toEqual(daemonInfo);
    });
  });
});
