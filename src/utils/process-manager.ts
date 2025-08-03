/**
 * Unified process management for Poltergeist
 * Consolidates process lifecycle, PID management, heartbeat, and inter-process coordination
 */

import { spawn, type ChildProcess } from 'child_process';
import { hostname } from 'os';
import type { Logger } from '../logger.js';

export interface ProcessInfo {
  pid: number;
  hostname: string;
  isActive: boolean;
  startTime: string;
  lastHeartbeat: string;
}

export interface ProcessOptions {
  heartbeatInterval?: number; // milliseconds, default 10000 (10 seconds)
  staleThreshold?: number; // milliseconds, default 300000 (5 minutes)
  shutdownTimeout?: number; // milliseconds, default 5000 (5 seconds)
}

export interface ManagedProcess {
  process: ChildProcess;
  id: string;
  startTime: Date;
  cleanup: () => Promise<void>;
}

/**
 * Centralized process management for all Poltergeist operations
 */
export class ProcessManager {
  private heartbeatInterval?: NodeJS.Timeout;
  private managedProcesses: Map<string, ManagedProcess> = new Map();
  private shutdownHandlersRegistered = false;
  private logger?: Logger;
  
  public readonly options: Required<ProcessOptions>;

  constructor(
    private updateHeartbeat: () => void,
    options: ProcessOptions = {},
    logger?: Logger
  ) {
    this.options = {
      heartbeatInterval: options.heartbeatInterval ?? 10000,
      staleThreshold: options.staleThreshold ?? 300000,
      shutdownTimeout: options.shutdownTimeout ?? 5000,
    };
    this.logger = logger;
  }

  /**
   * Check if a process is still alive by sending signal 0
   */
  public static isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create process info for the current process
   */
  public static createProcessInfo(): ProcessInfo {
    const now = new Date().toISOString();
    return {
      pid: process.pid,
      hostname: hostname(),
      isActive: true,
      startTime: now,
      lastHeartbeat: now,
    };
  }

  /**
   * Update process info with current heartbeat
   */
  public static updateProcessInfo(processInfo: ProcessInfo): ProcessInfo {
    return {
      ...processInfo,
      lastHeartbeat: new Date().toISOString(),
      isActive: ProcessManager.isProcessAlive(processInfo.pid),
    };
  }

  /**
   * Check if process info indicates a stale/inactive process
   */
  public isProcessStale(processInfo: ProcessInfo): boolean {
    if (!ProcessManager.isProcessAlive(processInfo.pid)) {
      return true;
    }

    const lastHeartbeat = new Date(processInfo.lastHeartbeat);
    const now = new Date();
    const timeSinceHeartbeat = now.getTime() - lastHeartbeat.getTime();
    
    return timeSinceHeartbeat > this.options.staleThreshold;
  }

  /**
   * Check if a process belongs to the current process (for lock ownership)
   */
  public isOwnProcess(processInfo: ProcessInfo): boolean {
    return processInfo.pid === process.pid && processInfo.hostname === hostname();
  }

  /**
   * Start periodic heartbeat updates
   */
  public startHeartbeat(): void {
    if (this.heartbeatInterval) {
      return; // Already started
    }

    this.heartbeatInterval = setInterval(() => {
      try {
        this.updateHeartbeat();
      } catch (error) {
        this.logger?.error('Heartbeat update failed:', error);
      }
    }, this.options.heartbeatInterval);

    this.logger?.debug(`Heartbeat started with ${this.options.heartbeatInterval}ms interval`);
  }

  /**
   * Stop periodic heartbeat updates
   */
  public stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
      this.logger?.debug('Heartbeat stopped');
    }
  }

  /**
   * Spawn and manage a child process with automatic cleanup
   */
  public spawnManagedProcess(
    id: string,
    command: string,
    args: string[] = [],
    options: any = {}
  ): Promise<ManagedProcess> {
    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        stdio: options.stdio || ['pipe', 'pipe', 'pipe'],
        env: options.env || process.env,
        cwd: options.cwd || process.cwd(),
        ...options,
      });

      const cleanup = async (): Promise<void> => {
        await this.terminateProcess(childProcess, this.options.shutdownTimeout);
        this.managedProcesses.delete(id);
      };

      const managedProcess: ManagedProcess = {
        process: childProcess,
        id,
        startTime: new Date(),
        cleanup,
      };

      childProcess.on('error', (error) => {
        this.logger?.error(`Process ${id} error:`, error);
        cleanup();
        reject(error);
      });

      childProcess.on('spawn', () => {
        this.managedProcesses.set(id, managedProcess);
        this.logger?.debug(`Process ${id} spawned with PID ${childProcess.pid}`);
        resolve(managedProcess);
      });

      childProcess.on('exit', (code, signal) => {
        this.logger?.debug(`Process ${id} exited with code ${code}, signal ${signal}`);
        cleanup();
      });
    });
  }

  /**
   * Gracefully terminate a process with timeout fallback to SIGKILL
   */
  public async terminateProcess(
    process: ChildProcess,
    timeoutMs: number = this.options.shutdownTimeout
  ): Promise<void> {
    if (!process.pid || process.killed) {
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!process.killed) {
          this.logger?.warn(`Force killing process ${process.pid} after timeout`);
          process.kill('SIGKILL');
        }
        resolve();
      }, timeoutMs);

      process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Try graceful termination first
      process.kill('SIGTERM');
    });
  }

  /**
   * Register graceful shutdown handlers for the current process
   */
  public registerShutdownHandlers(cleanup: () => Promise<void>): void {
    if (this.shutdownHandlersRegistered) {
      return;
    }

    const gracefulShutdown = async (signal: string) => {
      this.logger?.info(`Received ${signal}, shutting down gracefully...`);
      
      try {
        await cleanup();
        await this.cleanupAllProcesses();
        this.stopHeartbeat();
        // Only exit if not in test environment
        if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
          process.exit(0);
        }
      } catch (error) {
        this.logger?.error('Error during shutdown:', error);
        // Only exit if not in test environment
        if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
          process.exit(1);
        }
      }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('exit', () => {
      this.stopHeartbeat();
      // Synchronous cleanup only
      for (const managed of this.managedProcesses.values()) {
        if (managed.process.pid && !managed.process.killed) {
          managed.process.kill('SIGKILL');
        }
      }
    });

    this.shutdownHandlersRegistered = true;
  }

  /**
   * Clean up all managed processes
   */
  public async cleanupAllProcesses(): Promise<void> {
    const cleanupPromises = Array.from(this.managedProcesses.values()).map(
      (managed) => managed.cleanup()
    );

    await Promise.allSettled(cleanupPromises);
    this.managedProcesses.clear();
  }

  /**
   * Get information about currently managed processes
   */
  public getManagedProcesses(): ReadonlyMap<string, ManagedProcess> {
    return this.managedProcesses;
  }

  /**
   * Get heartbeat age in milliseconds
   */
  public getHeartbeatAge(processInfo: ProcessInfo): number {
    const lastHeartbeat = new Date(processInfo.lastHeartbeat);
    const now = new Date();
    return now.getTime() - lastHeartbeat.getTime();
  }

  /**
   * Format heartbeat age as human-readable string
   */
  public formatHeartbeatAge(processInfo: ProcessInfo): string {
    const ageMs = this.getHeartbeatAge(processInfo);
    const seconds = Math.floor(ageMs / 1000);
    
    if (seconds < 60) {
      return `${seconds}s ago`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m ago`;
    } else {
      return `${Math.floor(seconds / 3600)}h ago`;
    }
  }
}