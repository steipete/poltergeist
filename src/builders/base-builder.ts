// Base builder class for all target types
import { type ChildProcess, execSync, spawn } from 'child_process';
import { createWriteStream, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Logger } from '../logger.js';
import type { StateManager } from '../state.js';
import type { BuildStatus, Target } from '../types.js';
import { BuildStatusManager } from '../utils/build-status-manager.js';

export interface BuildOptions {
  captureLogs?: boolean;
  logFile?: string;
}

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

  public async build(changedFiles: string[], options: BuildOptions = {}): Promise<BuildStatus> {
    // Format file list for logging
    const fileListText = this.formatChangedFiles(changedFiles);
    this.logger.info(
      `[${this.target.name}] Building with ${changedFiles.length} changed file(s)${fileListText}`
    );

    // Check if already building using state manager
    if (await this.stateManager.isLocked(this.target.name)) {
      this.logger.warn(`[${this.target.name}] Build already in progress, skipping`);
      return BuildStatusManager.createBuildingStatus(this.target.name, {
        gitHash: this.getGitHash(),
        builder: this.getBuilderName(),
      });
    }

    const startTime = Date.now();
    const buildingStatus = BuildStatusManager.createBuildingStatus(this.target.name, {
      gitHash: this.getGitHash(),
      builder: this.getBuilderName(),
    });

    try {
      // Initialize state for this target
      await this.stateManager.initializeState(this.target);

      // Update build status to building
      await this.stateManager.updateBuildStatus(this.target.name, buildingStatus);

      // Pre-build hook
      await this.preBuild(changedFiles);

      // Execute build command
      await this.executeBuild(options);

      // Post-build hook
      await this.postBuild();

      // Create success metrics and status
      const metrics = BuildStatusManager.createMetrics(startTime, Date.now());
      const successStatus = BuildStatusManager.createSuccessStatus(this.target.name, metrics, {
        gitHash: this.getGitHash(),
        builder: this.getBuilderName(),
      });

      this.logger.info(
        `[${this.target.name}] Build completed in ${BuildStatusManager.formatDuration(metrics.duration)}`
      );

      // Update app info if available
      const outputInfo = this.getOutputInfo();
      if (outputInfo) {
        await this.stateManager.updateAppInfo(this.target.name, {
          outputPath: outputInfo,
        });
      }

      // Update final build status
      await this.stateManager.updateBuildStatus(this.target.name, successStatus);
      return successStatus;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const buildError = BuildStatusManager.createError(errorMessage);
      const metrics = BuildStatusManager.createMetrics(startTime, Date.now());

      const failureStatus = BuildStatusManager.createFailureStatus(
        this.target.name,
        buildError,
        metrics,
        {
          gitHash: this.getGitHash(),
          builder: this.getBuilderName(),
        }
      );

      this.logger.error(`[${this.target.name}] Build failed: ${buildError.message}`);

      // Update final build status
      await this.stateManager.updateBuildStatus(this.target.name, failureStatus);
      return failureStatus;
    }
  }

  protected getExecutionCommand(): string {
    if (this.target.type === 'test' && 'testCommand' in this.target) {
      return this.target.testCommand;
    }
    return this.target.buildCommand || '';
  }

  protected async executeBuild(options: BuildOptions = {}): Promise<void> {
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

      // Determine stdio configuration based on log capture option
      let stdio: any = 'inherit';
      let logStream: any = null;

      if (options.captureLogs && options.logFile) {
        // Create log directory if it doesn't exist
        const logDir = dirname(options.logFile);
        mkdirSync(logDir, { recursive: true });

        // Create write stream for log file
        logStream = createWriteStream(options.logFile, { flags: 'w' });

        // Capture stdout and stderr but keep stdin inherited
        stdio = ['inherit', 'pipe', 'pipe'];
      }

      this.currentProcess = spawn(command, {
        cwd: this.projectRoot,
        env,
        shell: true,
        stdio,
      });

      // If capturing logs, pipe stdout and stderr to both log file and console
      if (
        options.captureLogs &&
        logStream &&
        this.currentProcess.stdout &&
        this.currentProcess.stderr
      ) {
        this.currentProcess.stdout.on('data', (data) => {
          logStream.write(data);
          process.stdout.write(data); // Also write to console
        });

        this.currentProcess.stderr.on('data', (data) => {
          logStream.write(data);
          process.stderr.write(data); // Also write to console
        });
      }

      this.currentProcess.on('close', (code) => {
        if (logStream) {
          logStream.end();
        }
        this.currentProcess = undefined;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Build process exited with code ${code}`));
        }
      });

      this.currentProcess.on('error', (error) => {
        if (logStream) {
          logStream.end();
        }
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

  private formatChangedFiles(changedFiles: string[]): string {
    if (changedFiles.length === 0) {
      return '';
    }

    // Show up to 3 files by name for clarity
    const maxFilesToShow = 3;
    const filesToShow = changedFiles.slice(0, maxFilesToShow);
    const remainingCount = changedFiles.length - maxFilesToShow;

    let fileList = filesToShow.join(', ');

    if (remainingCount > 0) {
      fileList += `, +${remainingCount} more`;
    }

    return `: ${fileList}`;
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
