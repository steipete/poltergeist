// Base builder class for all target types
import { type ChildProcess, execSync, spawn } from 'child_process';
import type { Logger } from '../logger.js';
import type { StateManager } from '../state.js';
import type { BuildStatus, Target } from '../types.js';

export abstract class BaseBuilder<T extends Target = Target> {
  protected target: T;
  protected projectRoot: string;
  protected logger: Logger;
  protected stateManager: StateManager;
  protected currentProcess?: ChildProcess;

  constructor(target: T, projectRoot: string, logger: Logger, stateManager: StateManager) {
    this.target = target;
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.stateManager = stateManager;
  }

  public async build(changedFiles: string[]): Promise<BuildStatus> {
    this.logger.info(`[${this.target.name}] Building with ${changedFiles.length} changed file(s)`);

    // Check if already building using state manager
    if (await this.stateManager.isLocked(this.target.name)) {
      this.logger.warn(`[${this.target.name}] Build already in progress, skipping`);
      return {
        targetName: this.target.name,
        status: 'building',
        timestamp: new Date().toISOString(),
      };
    }

    const startTime = Date.now();
    const status: BuildStatus = {
      targetName: this.target.name,
      status: 'building',
      timestamp: new Date().toISOString(),
      gitHash: this.getGitHash(),
      builder: this.getBuilderName(),
    };

    try {
      // Initialize state for this target
      await this.stateManager.initializeState(this.target);

      // Update build status to building
      await this.stateManager.updateBuildStatus(this.target.name, status);

      // Pre-build hook
      await this.preBuild(changedFiles);

      // Execute build command
      await this.executeBuild();

      // Post-build hook
      await this.postBuild();

      // Update status to success
      status.status = 'success';
      status.duration = Date.now() - startTime;
      status.buildTime = status.duration / 1000; // seconds

      this.logger.info(`[${this.target.name}] Build completed in ${status.duration}ms`);

      // Update app info if available
      const outputInfo = this.getOutputInfo();
      if (outputInfo) {
        await this.stateManager.updateAppInfo(this.target.name, {
          outputPath: outputInfo,
        });
      }
    } catch (error) {
      status.status = 'failure';
      status.error = error instanceof Error ? error.message : String(error);
      status.errorSummary = this.extractErrorSummary(status.error);
      status.duration = Date.now() - startTime;

      this.logger.error(`[${this.target.name}] Build failed: ${status.error}`);
    } finally {
      // Update final build status
      await this.stateManager.updateBuildStatus(this.target.name, status);
    }

    return status;
  }

  protected getExecutionCommand(): string {
    if (this.target.type === 'test' && 'testCommand' in this.target) {
      return this.target.testCommand;
    }
    return this.target.buildCommand || '';
  }

  protected async executeBuild(): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = this.getExecutionCommand();
      if (!command) {
        reject(new Error(`No command defined for ${this.target.type} target: ${this.target.name}`));
        return;
      }

      const env = {
        ...process.env,
        ...this.target.environment,
      };

      this.currentProcess = spawn(command, {
        cwd: this.projectRoot,
        env,
        shell: true,
        stdio: 'inherit',
      });

      this.currentProcess.on('close', (code) => {
        this.currentProcess = undefined;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Build process exited with code ${code}`));
        }
      });

      this.currentProcess.on('error', (error) => {
        this.currentProcess = undefined;
        reject(error);
      });
    });
  }

  protected getGitHash(): string {
    try {
      return execSync('git rev-parse --short HEAD', {
        cwd: this.projectRoot,
        encoding: 'utf-8',
      }).trim();
    } catch {
      return 'unknown';
    }
  }

  protected getBuilderName(): string {
    // Override in subclasses for specific builder names
    return this.target.type;
  }

  protected extractErrorSummary(error: string): string {
    // Extract the most relevant part of the error message
    const lines = error.split('\n');

    // Look for common error patterns
    for (const line of lines) {
      // TypeScript errors
      if (line.includes('error TS')) {
        return line.trim();
      }
      // Swift errors
      if (line.includes('error:') || line.includes('Error:')) {
        return line.trim();
      }
      // Generic compilation errors
      if (line.toLowerCase().includes('compilation failed')) {
        return line.trim();
      }
    }

    // Return first non-empty line if no specific pattern found
    return lines.find((l) => l.trim().length > 0)?.trim() || error.substring(0, 100);
  }

  public stop(): void {
    if (this.currentProcess) {
      this.logger.info(`[${this.target.name}] Stopping build process`);
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = undefined;
    }
  }

  // Hooks for subclasses
  protected async preBuild(_changedFiles: string[]): Promise<void> {
    // Override in subclasses if needed
  }

  protected async postBuild(): Promise<void> {
    // Override in subclasses if needed
  }

  // Abstract methods that subclasses must implement
  public abstract validate(): Promise<void>;
  public abstract getOutputInfo(): string | undefined;
}
