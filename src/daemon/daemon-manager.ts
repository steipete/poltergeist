import { fork } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join, sep } from 'path';
import type { Logger } from '../logger.js';
import type { PoltergeistConfig } from '../types.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import { ProcessManager } from '../utils/process-manager.js';

export interface DaemonInfo {
  pid: number;
  startTime: string;
  logFile: string;
  projectPath: string;
  configPath?: string;
}

export interface DaemonOptions {
  projectRoot: string;
  configPath?: string;
  target?: string;
  verbose?: boolean;
}

interface DaemonMessage {
  type: 'started' | 'error';
  pid?: number;
  error?: string;
}

export class DaemonManager {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Get the daemon info file path for a project
   */
  private getDaemonInfoPath(projectPath: string): string {
    const projectName = projectPath.split(sep).pop() || 'unknown';
    const hash = createHash('sha256').update(projectPath).digest('hex').substring(0, 8);
    return join(FileSystemUtils.getStateDirectory(), `${projectName}-${hash}-daemon.json`);
  }

  /**
   * Get the log file path for a project
   */
  private getLogFilePath(projectPath: string): string {
    const projectName = projectPath.split(sep).pop() || 'unknown';
    const hash = createHash('sha256').update(projectPath).digest('hex').substring(0, 8);
    return join(FileSystemUtils.getStateDirectory(), `${projectName}-${hash}-daemon.log`);
  }

  /**
   * Check if a daemon is already running for this project
   */
  async isDaemonRunning(projectPath: string): Promise<boolean> {
    const infoPath = this.getDaemonInfoPath(projectPath);

    if (!existsSync(infoPath)) {
      return false;
    }

    try {
      const content = await readFile(infoPath, 'utf-8');
      const info: DaemonInfo = JSON.parse(content);

      // Check if process is actually running
      if (ProcessManager.isProcessAlive(info.pid)) {
        return true;
      } else {
        // Process doesn't exist, clean up stale info file
        await this.cleanupDaemonInfo(projectPath);
        return false;
      }
    } catch (error) {
      this.logger.error('Failed to read daemon info:', error);
      return false;
    }
  }

  /**
   * Get daemon info for a running daemon
   */
  async getDaemonInfo(projectPath: string): Promise<DaemonInfo | null> {
    const infoPath = this.getDaemonInfoPath(projectPath);

    if (!existsSync(infoPath)) {
      return null;
    }

    try {
      const content = await readFile(infoPath, 'utf-8');
      const info: DaemonInfo = JSON.parse(content);

      // Verify process is running
      if (ProcessManager.isProcessAlive(info.pid)) {
        return info;
      } else {
        await this.cleanupDaemonInfo(projectPath);
        return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Start a daemon process
   */
  async startDaemon(config: PoltergeistConfig, options: DaemonOptions): Promise<number> {
    const { projectRoot, configPath, target, verbose } = options;

    // Check if already running
    if (await this.isDaemonRunning(projectRoot)) {
      throw new Error('Daemon already running for this project');
    }

    // Ensure state directory exists
    const stateDir = FileSystemUtils.getStateDirectory();
    await mkdir(stateDir, { recursive: true });

    const logFile = this.getLogFilePath(projectRoot);
    const daemonWorkerPath = join(
      dirname(import.meta.url.replace('file://', '')),
      'daemon-worker.js'
    );

    // Prepare arguments for daemon
    const daemonArgs = JSON.stringify({
      config,
      projectRoot,
      configPath,
      target,
      verbose,
      logFile,
    });

    // Fork the daemon process
    const child = fork(daemonWorkerPath, [daemonArgs], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env },
    });

    // Wait for daemon to confirm startup
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Daemon startup timeout'));
      }, 10000); // 10 second timeout

      child.once('message', async (message: DaemonMessage) => {
        clearTimeout(timeout);

        if (message.type === 'started' && message.pid) {
          // Save daemon info
          const daemonInfo: DaemonInfo = {
            pid: message.pid,
            startTime: new Date().toISOString(),
            logFile,
            projectPath: projectRoot,
            configPath,
          };

          await this.saveDaemonInfo(projectRoot, daemonInfo);

          // Detach from parent
          child.unref();
          child.disconnect();

          resolve(message.pid);
        } else if (message.type === 'error') {
          reject(new Error(message.error || 'Daemon startup failed'));
        }
      });

      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Stop a running daemon
   */
  async stopDaemon(projectPath: string): Promise<void> {
    const info = await this.getDaemonInfo(projectPath);

    if (!info) {
      throw new Error('No daemon running for this project');
    }

    try {
      // Send graceful shutdown signal
      process.kill(info.pid, 'SIGTERM');

      // Wait for process to exit (with timeout)
      await this.waitForProcessExit(info.pid, 5000);

      // Clean up info file
      await this.cleanupDaemonInfo(projectPath);
    } catch (error) {
      // Force kill if graceful shutdown failed
      try {
        process.kill(info.pid, 'SIGKILL');
      } catch {
        // Process already dead
      }

      await this.cleanupDaemonInfo(projectPath);
      throw new Error(`Failed to stop daemon: ${error}`);
    }
  }

  /**
   * Save daemon info to file
   */
  private async saveDaemonInfo(projectPath: string, info: DaemonInfo): Promise<void> {
    const infoPath = this.getDaemonInfoPath(projectPath);
    await writeFile(infoPath, JSON.stringify(info, null, 2));
  }

  /**
   * Clean up daemon info file
   */
  private async cleanupDaemonInfo(projectPath: string): Promise<void> {
    const infoPath = this.getDaemonInfoPath(projectPath);
    try {
      await unlink(infoPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Wait for a process to exit
   */
  private async waitForProcessExit(pid: number, timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (ProcessManager.isProcessAlive(pid)) {
        // Process still exists, wait a bit
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        // Process no longer exists
        return;
      }
    }

    throw new Error('Process exit timeout');
  }

  /**
   * Read the last N lines from the log file
   */
  async readLogFile(projectPath: string, lines?: number): Promise<string[]> {
    const logFile = this.getLogFilePath(projectPath);

    if (!existsSync(logFile)) {
      return [];
    }

    try {
      const content = await readFile(logFile, 'utf-8');
      const allLines = content.split('\n').filter((line) => line.trim());

      if (lines && lines > 0) {
        return allLines.slice(-lines);
      }

      return allLines;
    } catch (error) {
      this.logger.error('Failed to read log file:', error);
      return [];
    }
  }
}
