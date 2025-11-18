// Unified state management for Poltergeist

import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { IStateManager } from './interfaces.js';
import type { Logger } from './logger.js';
import type { BuildStatus, Target } from './types.js';
import { writeFileAtomic } from './utils/atomic-write.js';
import { FileSystemUtils } from './utils/filesystem.js';
import { type ProcessInfo, ProcessManager } from './utils/process-manager.js';

// Re-export ProcessInfo for compatibility
export type { ProcessInfo } from './utils/process-manager.js';
export interface PostBuildResult {
  name: string;
  status: 'pending' | 'running' | 'success' | 'failure';
  summary?: string;
  lines?: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  formatterError?: string;
  trigger?: 'success' | 'failure';
}

export interface AppInfo {
  bundleId?: string;
  outputPath?: string;
  iconPath?: string;
}

export interface BuildStatistics {
  successfulBuilds: Array<{ duration: number; timestamp: string }>;
  averageDuration: number;
  minDuration?: number;
  maxDuration?: number;
}

export interface PoltergeistState {
  version: string;
  projectPath: string;
  projectName: string;
  target: string;
  targetType: string;
  configPath: string;

  process: ProcessInfo;
  lastBuild?: BuildStatus;
  appInfo?: AppInfo;
  buildStats?: BuildStatistics;
  lastBuildError?: {
    exitCode: number;
    errorOutput: string[];
    lastOutput: string[];
    command: string;
    timestamp: string;
  };
  postBuildResults?: Record<string, PostBuildResult>;
}

export class StateManager implements IStateManager {
  private logger: Logger;
  private projectRoot: string;
  private processManager: ProcessManager;
  private states: Map<string, PoltergeistState> = new Map();
  private stateDir: string;

  constructor(projectRoot: string, logger: Logger) {
    this.logger = logger;
    this.projectRoot = projectRoot;
    this.stateDir = FileSystemUtils.getStateDirectory();

    // Initialize ProcessManager with heartbeat callback
    this.processManager = new ProcessManager(
      () => this.updateHeartbeat(),
      {}, // Use default options
      logger
    );

    // Ensure state directory exists
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
  }

  /**
   * Get full path to state file
   */
  private getStateFilePath(targetName: string): string {
    return FileSystemUtils.getStateFilePath(this.projectRoot, targetName);
  }

  /**
   * Initialize state for a target
   */
  public async initializeState(target: Target): Promise<PoltergeistState> {
    const configPath = join(this.projectRoot, '.poltergeist.json');

    const state: PoltergeistState = {
      version: '1.0',
      projectPath: this.projectRoot,
      projectName: this.projectRoot.split('/').pop() || 'unknown',
      target: target.name,
      targetType: target.type,
      configPath,

      process: ProcessManager.createProcessInfo(),
    };

    // Add app info if available
    if (target.type === 'app-bundle' && 'bundleId' in target) {
      state.appInfo = {
        bundleId: target.bundleId,
      };
    } else if (target.type === 'executable' && 'outputPath' in target) {
      state.appInfo = {
        outputPath: target.outputPath,
      };
    }

    // Add icon path if configured
    if (target.icon) {
      state.appInfo = state.appInfo || {};
      state.appInfo.iconPath = target.icon;
    }

    this.states.set(target.name, state);
    await this.writeState(target.name);

    return state;
  }

  /**
   * Update build status in state
   */
  public async updateBuildStatus(targetName: string, buildStatus: BuildStatus): Promise<void> {
    const state = this.states.get(targetName);
    if (!state) {
      this.logger.error(`No state found for target: ${targetName}`);
      return;
    }

    state.lastBuild = buildStatus;

    // Update build statistics for successful builds
    if (buildStatus.status === 'success' && (buildStatus.duration || buildStatus.buildTime)) {
      const duration = buildStatus.duration || buildStatus.buildTime || 0;

      if (!state.buildStats) {
        state.buildStats = {
          successfulBuilds: [],
          averageDuration: 0,
        };
      }

      // Add this build to the history
      state.buildStats.successfulBuilds.push({
        duration,
        timestamp: buildStatus.timestamp,
      });

      // Keep only the last 10 builds
      if (state.buildStats.successfulBuilds.length > 10) {
        state.buildStats.successfulBuilds = state.buildStats.successfulBuilds.slice(-10);
      }

      // Calculate statistics
      const durations = state.buildStats.successfulBuilds.map((b) => b.duration);
      state.buildStats.averageDuration = Math.round(
        durations.reduce((a, b) => a + b, 0) / durations.length
      );
      state.buildStats.minDuration = Math.min(...durations);
      state.buildStats.maxDuration = Math.max(...durations);
    }

    await this.writeState(targetName);
  }

  /**
   * Update app info (e.g., after successful build)
   */
  public async updateAppInfo(targetName: string, appInfo: Partial<AppInfo>): Promise<void> {
    const state = this.states.get(targetName);
    if (!state) {
      this.logger.error(`No state found for target: ${targetName}`);
      return;
    }

    state.appInfo = { ...state.appInfo, ...appInfo };
    await this.writeState(targetName);
  }

  /**
   * Update build error context for better diagnostics
   */
  public async updateBuildError(
    targetName: string,
    errorContext: {
      exitCode: number;
      errorOutput: string[];
      lastOutput: string[];
      command: string;
      timestamp: string;
    }
  ): Promise<void> {
    const state = this.states.get(targetName);
    if (!state) {
      this.logger.error(`No state found for target: ${targetName}`);
      return;
    }

    // Store error context in state
    state.lastBuildError = errorContext;
    await this.writeState(targetName);
  }

  public async updatePostBuildResult(
    targetName: string,
    hookName: string,
    updates: Partial<PostBuildResult>
  ): Promise<void> {
    const state = this.states.get(targetName);
    if (!state) {
      this.logger.error(`No state found for target: ${targetName}`);
      return;
    }

    if (!state.postBuildResults) {
      state.postBuildResults = {};
    }

    const existing = state.postBuildResults[hookName] || {
      name: hookName,
      status: 'pending',
    };

    state.postBuildResults[hookName] = {
      ...existing,
      ...updates,
      name: hookName,
    };

    await this.writeState(targetName);
  }

  /**
   * Forcefully clear locks and mark processes inactive for a target.
   * Used by manual --force builds to take over from stuck processes.
   */
  public async forceUnlock(targetName: string): Promise<boolean> {
    const stateFile = this.getStateFilePath(targetName);
    const lockFile = stateFile.replace('.state', '.lock');
    let unlocked = false;

    if (existsSync(lockFile)) {
      try {
        unlinkSync(lockFile);
        unlocked = true;
        this.logger.warn(`Force unlocked lock file for ${targetName}`);
      } catch (error) {
        this.logger.error(`Failed to remove lock file for ${targetName}: ${error}`);
      }
    }

    const state = await this.readState(targetName);
    if (state) {
      state.process.isActive = false;
      this.states.set(targetName, state);
      await this.writeState(targetName, false);
      unlocked = true;
      this.logger.warn(`Marked process inactive for ${targetName} due to force unlock`);
    }

    return unlocked;
  }

  /**
   * Writes state to file using write-file-atomic for robust cross-platform atomic writes.
   * This prevents corruption during concurrent writes and handles Windows race conditions.
   */
  private async writeState(targetName: string, updateProcessInfo = true): Promise<void> {
    const state = this.states.get(targetName);
    if (!state) return;

    const stateFile = this.getStateFilePath(targetName);

    try {
      // Ensure state directory exists
      await this.ensureStateDirectory();

      // Update heartbeat and process info (if requested)
      if (updateProcessInfo) {
        state.process = ProcessManager.updateProcessInfo(state.process);
      }

      // Use write-file-atomic for robust cross-platform atomic writes
      // This handles temp file creation, writing, and atomic rename automatically
      // with proper Windows race condition handling
      await writeFileAtomic(stateFile, JSON.stringify(state, null, 2), {
        // Ensure proper file encoding
        encoding: 'utf8',
        // Create temp files in the same directory for atomic rename
        tmpfileCreated: (tmpfile: string) => {
          this.logger.debug(`Created temp file for ${targetName}: ${tmpfile}`);
        },
      });

      this.logger.debug(`State updated for ${targetName}`);
    } catch (error) {
      // Handle Windows ENOENT errors during test cleanup
      if (error instanceof Error && error.message.includes('ENOENT')) {
        // Check if this is a test cleanup race condition
        if (!existsSync(this.stateDir)) {
          this.logger.debug(
            `State directory removed during write for ${targetName}, skipping state write`
          );
          return; // Skip if directory was cleaned up during write
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to write state for ${targetName}: ${errorMessage}`);
      this.logger.error(`State directory: ${this.stateDir}, exists: ${existsSync(this.stateDir)}`);
      this.logger.error(`State file: ${stateFile}`);
      throw error;
    }
  }

  /**
   * Ensures state directory exists with Windows-specific retry logic
   */
  private async ensureStateDirectory(): Promise<void> {
    const maxRetries = process.platform === 'win32' ? 3 : 1;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!existsSync(this.stateDir)) {
          mkdirSync(this.stateDir, { recursive: true });
        }

        // Double-check directory exists after creation (Windows race condition)
        if (!existsSync(this.stateDir)) {
          throw new Error(`State directory does not exist after creation: ${this.stateDir}`);
        }

        return; // Success!
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        // Small delay before retry
        await new Promise((resolve) => setTimeout(resolve, 5 * attempt));
      }
    }
  }

  /**
   * Read state from file
   */
  public async readState(targetName: string): Promise<PoltergeistState | null> {
    const stateFile = this.getStateFilePath(targetName);

    try {
      if (!existsSync(stateFile)) {
        return null;
      }

      const data = readFileSync(stateFile, 'utf-8');
      const state = JSON.parse(data) as PoltergeistState;

      // Check if process is still active
      if (state.process.pid !== process.pid) {
        // Check if process exists
        state.process.isActive = ProcessManager.isProcessAlive(state.process.pid);
      }

      return state;
    } catch (error) {
      this.logger.error(`Failed to read state for ${targetName}: ${error}`);
      return null;
    }
  }

  /**
   * Checks if target is locked by another active Poltergeist process.
   * Uses multi-layer validation:
   * 1. Process ownership (same PID = not locked)
   * 2. Process active flag
   * 3. Heartbeat freshness (5 minute timeout for stale detection)
   *
   * This prevents duplicate builds across multiple Poltergeist instances.
   */
  public async isLocked(targetName: string): Promise<boolean> {
    // First check for a lock file - this takes priority over state
    const stateFile = FileSystemUtils.getStateFilePath(this.projectRoot, targetName);
    const lockFile = stateFile.replace('.state', '.lock');

    // Check if lock file exists
    if (existsSync(lockFile)) {
      try {
        const lockData = JSON.parse(readFileSync(lockFile, 'utf-8'));
        // Lock file exists - check if it's from our process
        if (lockData.pid === process.pid) {
          return false; // Our own lock
        }
        // Check if lock is stale (older than 5 minutes)
        if (lockData.timestamp && Date.now() - lockData.timestamp > 300000) {
          // Stale lock - remove it
          unlinkSync(lockFile);
          return false;
        }
        // Valid lock from another process
        return true;
      } catch (_error) {
        // Invalid lock file - remove it
        try {
          unlinkSync(lockFile);
        } catch {}
        return false;
      }
    }

    // Fall back to state-based check
    const state = await this.readState(targetName);
    if (!state) return false;

    // Not locked if it's our own process
    if (state.process.pid === process.pid) {
      return false;
    }

    // Not locked if process marked as inactive
    if (!state.process.isActive) {
      return false;
    }

    // Check heartbeat age - process may have crashed without cleanup
    if (this.processManager.isProcessStale(state.process)) {
      this.logger.info(`Stale state detected for ${targetName}, considering unlocked`);
      return false;
    }

    return true;
  }

  /**
   * Start heartbeat updates
   */
  public startHeartbeat(): void {
    this.processManager.startHeartbeat();
  }

  /**
   * Stop heartbeat updates
   */
  public stopHeartbeat(): void {
    this.processManager.stopHeartbeat();
  }

  /**
   * Update heartbeat for all active states (called by ProcessManager)
   */
  protected async updateHeartbeat(): Promise<void> {
    for (const targetName of this.states.keys()) {
      await this.writeState(targetName);
    }
  }

  /**
   * Update state with partial updates
   */
  public async updateState(targetName: string, updates: Partial<PoltergeistState>): Promise<void> {
    const currentState = await this.readState(targetName);
    if (!currentState) {
      throw new Error(`State not found for target: ${targetName}`);
    }

    const updatedState = { ...currentState, ...updates };
    this.states.set(targetName, updatedState);
    await this.writeState(targetName);
  }

  /**
   * Discover all states in the state directory
   */
  public async discoverStates(): Promise<Record<string, Partial<PoltergeistState>>> {
    const states: Record<string, Partial<PoltergeistState>> = {};

    if (!existsSync(this.stateDir)) {
      return states;
    }

    const files = await import('fs/promises').then((fs) => fs.readdir(this.stateDir));

    for (const file of files) {
      if (file.endsWith('.state')) {
        try {
          const content = readFileSync(join(this.stateDir, file), 'utf-8');
          const state = JSON.parse(content) as PoltergeistState;
          const targetName = file.replace('.state', '').split('-').pop() || '';
          states[targetName] = state;
        } catch (error) {
          this.logger.debug(`Failed to read state file ${file}: ${error}`);
        }
      }
    }

    return states;
  }

  /**
   * Clean up state files on exit
   */
  public async cleanup(): Promise<void> {
    this.stopHeartbeat();

    for (const [targetName, state] of this.states.entries()) {
      state.process.isActive = false;
      await this.writeState(targetName, false); // Don't update process info during cleanup
    }
  }

  /**
   * Remove state file
   */
  public async removeState(targetName: string): Promise<void> {
    const stateFile = this.getStateFilePath(targetName);

    try {
      if (existsSync(stateFile)) {
        unlinkSync(stateFile);
      }
      this.states.delete(targetName);
    } catch (error) {
      this.logger.error(`Failed to remove state for ${targetName}: ${error}`);
    }
  }

  /**
   * List all state files in the state directory
   */
  public static async listAllStates(): Promise<string[]> {
    const fs = await import('fs/promises');
    const stateDir = FileSystemUtils.getStateDirectory();

    try {
      if (!existsSync(stateDir)) {
        return [];
      }

      const files = await fs.readdir(stateDir);
      return files.filter((f) => f.endsWith('.state'));
    } catch {
      return [];
    }
  }
}
