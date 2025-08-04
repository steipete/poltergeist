// Unified state management for Poltergeist

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { IStateManager } from './interfaces.js';
import type { Logger } from './logger.js';
import type { BuildStatus, Target } from './types.js';
import { FileSystemUtils } from './utils/filesystem.js';
import { type ProcessInfo, ProcessManager } from './utils/process-manager.js';

// Re-export ProcessInfo for compatibility
export type { ProcessInfo } from './utils/process-manager.js';

export interface AppInfo {
  bundleId?: string;
  outputPath?: string;
  iconPath?: string;
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
   * Writes state to file using atomic temp-file + rename pattern.
   * This prevents corruption during concurrent writes from multiple processes.
   * Uses PID and timestamp in temp filename for uniqueness.
   */
  private async writeState(targetName: string, updateProcessInfo = true): Promise<void> {
    const state = this.states.get(targetName);
    if (!state) return;

    const stateFile = this.getStateFilePath(targetName);
    // Use unique temp file to prevent concurrent write conflicts
    const tempFile = `${stateFile}.${process.pid}.${Date.now()}.tmp`;

    try {
      // Ensure state directory exists with more robust checking
      if (!existsSync(this.stateDir)) {
        mkdirSync(this.stateDir, { recursive: true });
      }

      // Double-check directory exists after creation (Windows race condition)
      if (!existsSync(this.stateDir)) {
        throw new Error(`State directory does not exist after creation: ${this.stateDir}`);
      }

      // Update heartbeat and process info (if requested)
      if (updateProcessInfo) {
        state.process = ProcessManager.updateProcessInfo(state.process);
      }

      // Write to temp file first
      writeFileSync(tempFile, JSON.stringify(state, null, 2));

      // Atomic rename ensures state file is never corrupted/partial
      renameSync(tempFile, stateFile);

      this.logger.debug(`State updated for ${targetName}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to write state for ${targetName}: ${err.message}`);
      this.logger.error(`State directory: ${this.stateDir}, exists: ${existsSync(this.stateDir)}`);
      this.logger.error(`State file: ${stateFile}`);
      this.logger.error(`Temp file: ${tempFile}`);

      // Clean up temp file if it exists
      try {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch {}

      // Re-throw to ensure callers know the operation failed
      throw err;
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
  private async updateHeartbeat(): Promise<void> {
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
