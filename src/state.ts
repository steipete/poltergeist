// Unified state management for Poltergeist
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { hostname } from 'os';
import { Logger } from './logger.js';
import { BuildStatus, Target } from './types.js';

// State directory
const STATE_DIR = '/tmp/poltergeist';

// Unified state interface
export interface ProcessInfo {
  pid: number;
  hostname: string;
  isActive: boolean;
  startTime: string;
  lastHeartbeat: string;
}

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

export class StateManager {
  private logger: Logger;
  private projectRoot: string;
  private heartbeatInterval?: NodeJS.Timeout;
  private states: Map<string, PoltergeistState> = new Map();

  constructor(projectRoot: string, logger: Logger) {
    this.logger = logger;
    this.projectRoot = projectRoot;
    
    // Ensure state directory exists
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
  }

  /**
   * Generate unique state file name for a target
   */
  private getStateFileName(targetName: string): string {
    const projectName = this.projectRoot.split('/').pop() || 'unknown';
    const projectHash = createHash('sha256')
      .update(this.projectRoot)
      .digest('hex')
      .substring(0, 8);
    
    return `${projectName}-${projectHash}-${targetName}.state`;
  }

  /**
   * Get full path to state file
   */
  private getStateFilePath(targetName: string): string {
    return join(STATE_DIR, this.getStateFileName(targetName));
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
      
      process: {
        pid: process.pid,
        hostname: hostname(),
        isActive: true,
        startTime: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      },
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
   * Write state to file atomically
   */
  private async writeState(targetName: string): Promise<void> {
    const state = this.states.get(targetName);
    if (!state) return;

    const stateFile = this.getStateFilePath(targetName);
    const tempFile = `${stateFile}.tmp`;

    try {
      // Update heartbeat
      state.process.lastHeartbeat = new Date().toISOString();
      
      // Write to temp file
      writeFileSync(tempFile, JSON.stringify(state, null, 2));
      
      // Atomic rename
      renameSync(tempFile, stateFile);
      
      this.logger.debug(`State updated for ${targetName}`);
    } catch (error) {
      this.logger.error(`Failed to write state for ${targetName}: ${error}`);
      
      // Clean up temp file if it exists
      try {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch {}
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
        try {
          // Check if process exists
          process.kill(state.process.pid, 0);
          state.process.isActive = true;
        } catch {
          state.process.isActive = false;
        }
      }
      
      return state;
    } catch (error) {
      this.logger.error(`Failed to read state for ${targetName}: ${error}`);
      return null;
    }
  }

  /**
   * Check if target is already being built by another process
   */
  public async isLocked(targetName: string): Promise<boolean> {
    const state = await this.readState(targetName);
    if (!state) return false;
    
    // Check if it's our own process
    if (state.process.pid === process.pid) {
      return false;
    }
    
    // Check if the process is still active
    if (!state.process.isActive) {
      return false;
    }
    
    // Check heartbeat age (5 minutes timeout)
    const heartbeatAge = Date.now() - new Date(state.process.lastHeartbeat).getTime();
    if (heartbeatAge > 5 * 60 * 1000) {
      this.logger.info(`Stale state detected for ${targetName}, considering unlocked`);
      return false;
    }
    
    return true;
  }

  /**
   * Start heartbeat updates
   */
  public startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    
    this.heartbeatInterval = setInterval(async () => {
      for (const targetName of this.states.keys()) {
        await this.writeState(targetName);
      }
    }, 10000); // Update every 10 seconds
  }

  /**
   * Stop heartbeat updates
   */
  public stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  /**
   * Clean up state files on exit
   */
  public async cleanup(): Promise<void> {
    this.stopHeartbeat();
    
    for (const [targetName, state] of this.states.entries()) {
      state.process.isActive = false;
      await this.writeState(targetName);
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
    
    try {
      if (!existsSync(STATE_DIR)) {
        return [];
      }
      
      const files = await fs.readdir(STATE_DIR);
      return files.filter(f => f.endsWith('.state'));
    } catch {
      return [];
    }
  }
}