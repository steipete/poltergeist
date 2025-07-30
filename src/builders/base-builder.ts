// Base builder class for all target types
import { spawn, ChildProcess } from 'child_process';
import { writeFileSync } from 'fs';
import { Logger } from '../logger.js';
import { BaseTarget, BuildStatus } from '../types.js';
import { Lock } from '../lock.js';

export abstract class BaseBuilder<T extends BaseTarget = BaseTarget> {
  protected target: T;
  protected projectRoot: string;
  protected logger: Logger;
  protected currentProcess?: ChildProcess;
  protected lock?: Lock;

  constructor(target: T, projectRoot: string, logger: Logger) {
    this.target = target;
    this.projectRoot = projectRoot;
    this.logger = logger;
    
    if (target.lockFile) {
      this.lock = new Lock(target.lockFile);
    }
  }

  public async build(changedFiles: string[]): Promise<BuildStatus> {
    this.logger.info(`[${this.target.name}] Starting build...`);
    
    // Check if already building
    if (this.lock && !await this.lock.acquire()) {
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
    };

    try {
      // Write initial status
      if (this.target.statusFile) {
        this.writeStatus(status);
      }

      // Pre-build hook
      await this.preBuild(changedFiles);

      // Execute build command
      await this.executeBuild();

      // Post-build hook
      await this.postBuild();

      // Update status
      status.status = 'success';
      status.duration = Date.now() - startTime;
      
      this.logger.info(`[${this.target.name}] Build completed in ${status.duration}ms`);
    } catch (error: any) {
      status.status = 'failure';
      status.error = error.message;
      status.duration = Date.now() - startTime;
      
      this.logger.error(`[${this.target.name}] Build failed: ${error.message}`);
    } finally {
      // Release lock
      if (this.lock) {
        await this.lock.release();
      }

      // Write final status
      if (this.target.statusFile) {
        this.writeStatus(status);
      }
    }

    return status;
  }

  protected async executeBuild(): Promise<void> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        ...this.target.environment,
      };

      this.currentProcess = spawn(this.target.buildCommand, {
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

  protected writeStatus(status: BuildStatus): void {
    if (!this.target.statusFile) return;
    
    try {
      writeFileSync(this.target.statusFile, JSON.stringify(status, null, 2));
    } catch (error) {
      this.logger.error(`[${this.target.name}] Failed to write status file: ${error}`);
    }
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