import type { ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, sep } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonManager } from '../dist/daemon/daemon-manager.js';
import { createLogger } from '../dist/logger.js';
import type { PoltergeistConfig } from '../dist/types.js';
import { FileSystemUtils } from '../dist/utils/filesystem.js';
import { ProcessManager } from '../dist/utils/process-manager.js';

// Stable mocks for child_process so vi.mock hoists safely
const { spawnMock, forkMock } = vi.hoisted(() => {
  const s = vi.fn();
  const f = vi.fn();
  return { spawnMock: s, forkMock: f };
});
vi.mock('child_process', () => ({ spawn: spawnMock, fork: forkMock }));

// Helper function to get project hash (same logic as DaemonManager)
function getProjectHash(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').substring(0, 8);
}

describe('DaemonManager', () => {
  let daemon: DaemonManager;
  let logger: ReturnType<typeof createLogger>;
  let testProjectPath: string;
  let stateDir: string;

  beforeEach(async () => {
    logger = createLogger();
    daemon = new DaemonManager(logger);
    // Use a more realistic test path that works on all platforms
    testProjectPath = process.platform === 'win32' ? 'C:\\test\\project' : '/test/project';
    stateDir = FileSystemUtils.getStateDirectory();

    // Ensure state directory exists
    await mkdir(stateDir, { recursive: true });

    // Clear any existing mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any test files
    const projectName = testProjectPath.split(sep).pop() || 'unknown';
    const hash = getProjectHash(testProjectPath);
    const daemonInfoPath = join(stateDir, `${projectName}-${hash}-daemon.json`);
    const logFilePath = join(stateDir, `${projectName}-${hash}-daemon.log`);

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
      const projectName = testProjectPath.split(sep).pop() || 'unknown';
      const hash = getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${projectName}-${hash}-daemon.json`);

      // Create daemon info with non-existent PID
      const daemonInfo = {
        pid: 99999999, // Very unlikely to be a real PID
        startTime: new Date().toISOString(),
        logFile: join(stateDir, `${projectName}-${hash}-daemon.log`),
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
      const projectName = testProjectPath.split(sep).pop() || 'unknown';
      const hash = getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${projectName}-${hash}-daemon.json`);

      // Create daemon info with current process PID (which is definitely running)
      const daemonInfo = {
        pid: process.pid,
        startTime: new Date().toISOString(),
        logFile: join(stateDir, `${projectName}-${hash}-daemon.log`),
        projectPath: testProjectPath,
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      // Mock ProcessManager.isProcessAlive to return true for current process
      vi.spyOn(ProcessManager, 'isProcessAlive').mockReturnValue(true);

      const result = await daemon.isDaemonRunning(testProjectPath);
      expect(result).toBe(true);

      // Restore mock
      vi.restoreAllMocks();
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

      // Mock the spawn function
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

      spawnMock.mockReturnValue(mockChild as ChildProcess);

      const pid = await daemon.startDaemon(config, {
        projectRoot: testProjectPath,
        verbose: false,
      });

      expect(pid).toBe(12345);
      expect(spawnMock).toHaveBeenCalledWith(
        process.execPath,
        expect.arrayContaining([expect.stringContaining('daemon-worker.js')]),
        expect.objectContaining({
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          cwd: testProjectPath,
        })
      );

      // Verify daemon info was saved
      const projectName = testProjectPath.split(sep).pop() || 'unknown';
      const hash = getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${projectName}-${hash}-daemon.json`);
      const savedInfo = JSON.parse(await readFile(daemonInfoPath, 'utf-8'));

      expect(savedInfo.pid).toBe(12345);
      expect(savedInfo.projectPath).toBe(testProjectPath);
    });

    it('should fail if daemon is already running', async () => {
      // Set up existing daemon
      const projectName = testProjectPath.split(sep).pop() || 'unknown';
      const hash = getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${projectName}-${hash}-daemon.json`);

      const daemonInfo = {
        pid: process.pid,
        startTime: new Date().toISOString(),
        logFile: join(stateDir, `${projectName}-${hash}-daemon.log`),
        projectPath: testProjectPath,
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      // Mock ProcessManager.isProcessAlive to return true for current process
      vi.spyOn(ProcessManager, 'isProcessAlive').mockReturnValue(true);

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

      // Restore mock
      vi.restoreAllMocks();
    });

    it('should handle daemon startup failure', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Mock spawn to simulate error
      const mockChild = {
        once: vi.fn((event, callback) => {
          if (event === 'message') {
            setTimeout(() => callback({ type: 'error', error: 'Startup failed' }), 10);
          }
        }),
        kill: vi.fn(),
      };

      spawnMock.mockReturnValue(mockChild as ChildProcess);

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

      // Set a short timeout for testing
      process.env.POLTERGEIST_DAEMON_TIMEOUT = '100';

      // Mock spawn to simulate timeout (don't send message)
      const mockChild = {
        once: vi.fn(),
        unref: vi.fn(),
        disconnect: vi.fn(),
        kill: vi.fn(),
      };

      spawnMock.mockReturnValue(mockChild as ChildProcess);

      // Simulate timeout by not calling the message callback
      mockChild.once.mockImplementation((event, _callback) => {
        if (event === 'message') {
          // Don't call the callback to simulate timeout
        } else if (event === 'error') {
          // Don't call error callback either
        }
      });

      await expect(
        daemon.startDaemonWithRetry(
          config,
          {
            projectRoot: testProjectPath,
          },
          1
        ) // Only 1 attempt to speed up test
      ).rejects.toThrow(/Daemon startup timeout after 100ms/);

      expect(mockChild.kill).toHaveBeenCalled();

      // Clean up environment variable
      delete process.env.POLTERGEIST_DAEMON_TIMEOUT;
    }, 10000); // Increase test timeout
  });

  describe('stopDaemon', () => {
    it('should successfully stop a running daemon', async () => {
      const projectName = testProjectPath.split(sep).pop() || 'unknown';
      const hash = getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${projectName}-${hash}-daemon.json`);

      // Create daemon info
      const daemonInfo = {
        pid: 12345,
        startTime: new Date().toISOString(),
        logFile: join(stateDir, `${projectName}-${hash}-daemon.log`),
        projectPath: testProjectPath,
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      // Mock ProcessManager.isProcessAlive to simulate process exists then dies
      let processAlive = true;
      vi.spyOn(ProcessManager, 'isProcessAlive').mockImplementation(() => {
        const wasAlive = processAlive;
        if (wasAlive) {
          processAlive = false; // Process dies after first check
        }
        return wasAlive;
      });

      // Mock process.kill to simulate successful termination
      const originalKill = process.kill;
      process.kill = vi.fn((_pid, signal) => {
        if (signal === 'SIGTERM') {
          // Simulate termination
          return true;
        }
        return true;
      }) as typeof process.kill;

      // Mock waitForProcessExit - access private method for testing
      interface DaemonManagerWithPrivate {
        waitForProcessExit: (pid: number, timeout: number) => Promise<void>;
      }
      vi.spyOn(
        daemon as unknown as DaemonManagerWithPrivate,
        'waitForProcessExit'
      ).mockResolvedValue(undefined);

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
      const projectName = testProjectPath.split(sep).pop() || 'unknown';
      const hash = getProjectHash(testProjectPath);
      const logFilePath = join(stateDir, `${projectName}-${hash}-daemon.log`);

      const logContent = `Line 1
Line 2
Line 3
Line 4
Line 5`;

      await mkdir(dirname(logFilePath), { recursive: true });
      await writeFile(logFilePath, logContent);

      const logs = await daemon.readLogFile(testProjectPath);
      expect(logs).toEqual(['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5']);
    });

    it('should limit returned lines when specified', async () => {
      const projectName = testProjectPath.split(sep).pop() || 'unknown';
      const hash = getProjectHash(testProjectPath);
      const logFilePath = join(stateDir, `${projectName}-${hash}-daemon.log`);

      const logContent = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n');

      await mkdir(dirname(logFilePath), { recursive: true });
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
      const projectName = testProjectPath.split(sep).pop() || 'unknown';
      const hash = getProjectHash(testProjectPath);
      const daemonInfoPath = join(stateDir, `${projectName}-${hash}-daemon.json`);

      const daemonInfo = {
        pid: process.pid,
        startTime: '2024-01-01T00:00:00.000Z',
        logFile: join(stateDir, `${projectName}-${hash}-daemon.log`),
        projectPath: testProjectPath,
        configPath: '/test/config.json',
      };

      await mkdir(stateDir, { recursive: true });
      await writeFile(daemonInfoPath, JSON.stringify(daemonInfo));

      // Mock ProcessManager.isProcessAlive to return true for current process
      vi.spyOn(ProcessManager, 'isProcessAlive').mockReturnValue(true);

      const info = await daemon.getDaemonInfo(testProjectPath);
      expect(info).toEqual(daemonInfo);

      // Restore mock
      vi.restoreAllMocks();
    });
  });
});
