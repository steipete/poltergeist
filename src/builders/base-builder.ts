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

  public getProjectRoot(): string {
    return this.projectRoot;
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

      // Always capture output for error diagnosis
      const stdio: ('inherit' | 'pipe')[] = ['inherit', 'pipe', 'pipe'];
      let logStream: NodeJS.WritableStream | null = null;
      let errorBuffer: string[] = [];
      let lastOutputLines: string[] = [];
      const maxErrorLines = 50;
      const maxOutputLines = 100;

      if (options.captureLogs && options.logFile) {
        // Create log directory if it doesn't exist
        const logDir = dirname(options.logFile);
        mkdirSync(logDir, { recursive: true });

        // Create write stream for log file
        logStream = createWriteStream(options.logFile, { flags: 'w' });
      }

      this.currentProcess = spawn(command, {
        cwd: this.projectRoot,
        env,
        shell: true,
        stdio,
      });

      // Capture and stream output in real-time
      if (this.currentProcess.stdout && this.currentProcess.stderr) {
        this.currentProcess.stdout.on('data', (data) => {
          const output = data.toString();
          
          // Keep recent output for error context
          const lines = output.split('\n').filter((l: string) => l.trim());
          lastOutputLines.push(...lines);
          if (lastOutputLines.length > maxOutputLines) {
            lastOutputLines = lastOutputLines.slice(-maxOutputLines);
          }
          
          // Write to log file if capturing
          if (logStream) {
            logStream.write(data);
          }
          
          // Stream to console in real-time
          process.stdout.write(data);
        });

        this.currentProcess.stderr.on('data', (data) => {
          const error = data.toString();
          
          // Capture error lines for diagnosis
          const lines = error.split('\n').filter((l: string) => l.trim());
          errorBuffer.push(...lines);
          if (errorBuffer.length > maxErrorLines) {
            errorBuffer = errorBuffer.slice(-maxErrorLines);
          }
          
          // Write to log file if capturing
          if (logStream) {
            logStream.write(data);
          }
          
          // Stream to console in real-time
          process.stderr.write(data);
        });
      }

      this.currentProcess.on('close', async (code) => {
        if (logStream) {
          logStream.end();
        }
        this.currentProcess = undefined;
        
        if (code === 0) {
          resolve();
        } else {
          // Create detailed error message with context
          let errorMessage = `Build process exited with code ${code}`;
          
          if (errorBuffer.length > 0) {
            errorMessage += `\n\nLast error output:\n${errorBuffer.slice(-10).join('\n')}`;
          } else if (lastOutputLines.length > 0) {
            errorMessage += `\n\nLast output:\n${lastOutputLines.slice(-10).join('\n')}`;
          }
          
          // Store error context in state for quick diagnosis
          try {
            await this.stateManager.updateBuildError(this.target.name, {
              exitCode: code || 1,
              errorOutput: errorBuffer.slice(-20),
              lastOutput: lastOutputLines.slice(-20),
              command,
              timestamp: new Date().toISOString(),
            });
          } catch (stateError) {
            this.logger.error(`Failed to store build error context: ${stateError}`);
          }
          
          reject(new Error(errorMessage));
        }
      });

      this.currentProcess.on('error', async (error) => {
        if (logStream) {
          logStream.end();
        }
        this.currentProcess = undefined;
        
        // Store error context
        try {
          await this.stateManager.updateBuildError(this.target.name, {
            exitCode: -1,
            errorOutput: [error.message],
            lastOutput: lastOutputLines.slice(-20),
            command,
            timestamp: new Date().toISOString(),
          });
        } catch (stateError) {
          this.logger.error(`Failed to store build error context: ${stateError}`);
        }
        
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
