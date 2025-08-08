import { fork, spawn } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, openSync } from 'fs';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join, sep } from 'path';
import { getDirname } from '../utils/paths.js';
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
  logLevel?: string;
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
   * Start a daemon process with retry logic
   */
  async startDaemonWithRetry(
    config: PoltergeistConfig,
    options: DaemonOptions,
    maxRetries = 3
  ): Promise<number> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info(`Starting daemon (attempt ${attempt}/${maxRetries})...`);
        return await this.startDaemon(config, options);
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Daemon startup failed (attempt ${attempt}/${maxRetries}): ${lastError.message}`
        );

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = 2 ** (attempt - 1) * 1000;
          this.logger.info(`Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Failed to start daemon after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Start a daemon process (internal implementation)
   */
  private async startDaemon(config: PoltergeistConfig, options: DaemonOptions): Promise<number> {
    const { projectRoot, configPath, target, verbose, logLevel } = options;

    // Check if already running
    if (await this.isDaemonRunning(projectRoot)) {
      throw new Error('Daemon already running for this project');
    }

    // Ensure state directory exists
    const stateDir = FileSystemUtils.getStateDirectory();
    await mkdir(stateDir, { recursive: true });

    const logFile = this.getLogFilePath(projectRoot);
    const daemonWorkerPath = join(
      getDirname(),
      'daemon-worker.js'
    );

    // Prepare arguments for daemon
    const daemonArgs = JSON.stringify({
      config,
      projectRoot,
      configPath,
      target,
      verbose,
      logLevel,
      logFile,
    });

    // Determine how to spawn the daemon
    let child;
    
    // Check if we're running as Bun standalone binary
    const isBunStandalone = !!process.versions.bun && process.execPath !== 'bun';
    
    if (isBunStandalone) {
      // For Bun standalone binaries, use regular spawn with detached flag
      const execPath = process.execPath;
      this.logger.info(`Using spawn for Bun standalone daemon: ${execPath}`);
      
      // Write daemon args to file for cleaner passing
      const argsFile = join(stateDir, `daemon-args-${Date.now()}.json`);
      await writeFile(argsFile, daemonArgs);
      
      // Use regular spawn with detached flag for proper daemon behavior
      // For debugging, write output to files
      const debugOut = join(stateDir, `daemon-debug-${Date.now()}.out`);
      const debugErr = join(stateDir, `daemon-debug-${Date.now()}.err`);
      
      const child = spawn(execPath, ['--daemon-mode', argsFile], {
        detached: true,
        stdio: ['ignore', 
                logFile ? openSync(logFile, 'a') : openSync(debugOut, 'w'),
                logFile ? openSync(logFile, 'a') : openSync(debugErr, 'w')],
        cwd: projectRoot,
        env: process.env,
      });
      
      const pid = child.pid;
      
      if (!pid) {
        throw new Error('Failed to start daemon process - no PID returned');
      }
      
      // Detach from parent
      child.unref();
      
      // Wait a moment and verify process is running
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      if (ProcessManager.isProcessAlive(pid)) {
        // Process is running, save daemon info
        const daemonInfo: DaemonInfo = {
          pid,
          startTime: new Date().toISOString(),
          logFile,
          projectPath: projectRoot,
          configPath,
        };
        await this.saveDaemonInfo(projectRoot, daemonInfo);
        this.logger.info(`Daemon started successfully with PID ${pid}`);
        
        // Clean up the args file after a delay
        setTimeout(async () => {
          try {
            await unlink(argsFile);
          } catch {
            // Ignore cleanup errors
          }
        }, 5000);
        
        return pid;
      } else {
        throw new Error('Daemon process exited immediately after starting');
      }
    } else {
      // For Node.js runtime, use fork as before
      child = fork(daemonWorkerPath, [daemonArgs], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env },
      });
    }

    // For Node.js with fork, wait for daemon to confirm startup via IPC
    if (!isBunStandalone && child) {
      return new Promise((resolve, reject) => {
        // Get timeout from environment variable or use default (60 seconds)
        // Increased default for complex projects with many files
        const timeoutMs = process.env.POLTERGEIST_DAEMON_TIMEOUT
          ? Number.parseInt(process.env.POLTERGEIST_DAEMON_TIMEOUT, 10)
          : 60000; // Default: 60 seconds

        const timeout = setTimeout(() => {
          child.kill();
          reject(
            new Error(
              `Daemon startup timeout after ${timeoutMs}ms. ` +
                'Try setting POLTERGEIST_DAEMON_TIMEOUT environment variable to a higher value.'
            )
          );
        }, timeoutMs);

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
    
    // Should never reach here - standalone returns early
    throw new Error('Unexpected code path');
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
    // Ensure the directory exists before writing
    await mkdir(dirname(infoPath), { recursive: true });
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
