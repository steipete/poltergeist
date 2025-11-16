// Base builder class for all target types
import { type ChildProcess, execSync, spawn } from 'child_process';
import { createWriteStream, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Logger } from '../logger.js';
import type { StateManager } from '../state.js';
import type { BuildProgress, BuildStatus, Target } from '../types.js';
import { BuildStatusManager } from '../utils/build-status-manager.js';
import { stripAnsi } from '../utils/ansi.js';

export const parseVitestProgressLine = (line: string): BuildProgress | null => {
  if (!/Test(s)?\s/i.test(line)) return null;
  const numbers = line.match(/\d+/g);
  if (!numbers || numbers.length < 2) return null;
  const total = Number.parseInt(numbers[numbers.length - 1] ?? '', 10);
  if (!Number.isFinite(total) || total <= 0) return null;
  const current = numbers
    .slice(0, -1)
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .reduce((sum, n) => sum + n, 0);
  if (!Number.isFinite(current) || current <= 0) return null;
  const percent = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  return {
    current,
    total,
    percent,
    label: 'Vitest',
    updatedAt: new Date().toISOString(),
  };
};

export interface BuildOptions {
  captureLogs?: boolean;
  logFile?: string;
  force?: boolean;
  onLock?: () => void;
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

    if (options.force) {
      const unlocked = await this.stateManager.forceUnlock(this.target.name);
      if (unlocked) {
        this.logger.warn(`[${this.target.name}] Force option enabled - cleared existing lock`);
      }
    }

    // Check if already building using state manager
    if (!options.force && (await this.stateManager.isLocked(this.target.name))) {
      this.logger.warn(`[${this.target.name}] Build already in progress, skipping`);
      options.onLock?.();
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
      let lastProgressPercent = -1;
      let lastProgressUpdate = 0;
      const throttleMs = 300;
      let testCurrent = 0;
      let testTotal = 0;
      const updateProgress = (progress: BuildProgress) => {
        const now = Date.now();
        if (progress.percent === lastProgressPercent && now - lastProgressUpdate < throttleMs) {
          return;
        }
        lastProgressPercent = progress.percent;
        lastProgressUpdate = now;
        const buildingStatus: BuildStatus = BuildStatusManager.createBuildingStatus(
          this.target.name,
          { gitHash: this.getGitHash(), builder: this.getBuilderName() }
        );
        buildingStatus.progress = progress;
        void this.stateManager.updateBuildStatus(this.target.name, buildingStatus);
      };

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

          // Extract progress indicators like "[12/50] Compiling Foo.swift"
          for (const raw of output.split('\n')) {
            const line = stripAnsi(raw).replace(/\r/g, '');
            const match = line.match(/^\[(\d+)\/(\d+)\]\s*(.*)$/);
            if (match) {
              const current = Number.parseInt(match[1], 10);
              const total = Number.parseInt(match[2], 10);
              if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
                const percent = Math.min(100, Math.max(0, Math.round((current / total) * 100)));
                const label = match[3]?.trim() || undefined;
                updateProgress({
                  current,
                  total,
                  percent,
                  label,
                  updatedAt: new Date().toISOString(),
                });
              }
            }

            // Vitest structured-ish progress lines, e.g. "Tests 2 failed | 5 passed | 7 total"
            const vitestProgress = parseVitestProgressLine(line);
            if (vitestProgress) {
              updateProgress(vitestProgress);
            }

            const sanitized = line;

            // Heuristic test progress for XCTest output
            if (this.target.type === 'test') {
              const testResult = sanitized.match(
                /^Test Case '-\[[^ ]+ ([^]]+)\]' (passed|failed) \(([\d.]+) seconds\)/
              );
              if (testResult) {
                testCurrent += 1;
                // If we don't yet know total, keep it at least as high as current.
                testTotal = Math.max(testTotal, testCurrent);
                const percent =
                  testTotal > 0
                    ? Math.min(100, Math.round((testCurrent / testTotal) * 100))
                    : undefined;
                if (percent !== undefined) {
                  updateProgress({
                    current: testCurrent,
                    total: testTotal,
                    percent,
                    label: `Test ${testCurrent}/${testTotal}`,
                    updatedAt: new Date().toISOString(),
                  });
                }
              }

              const executed = sanitized.match(/^Executed (\d+) tests?, with /);
              if (executed) {
                const reported = Number.parseInt(executed[1], 10);
                if (Number.isFinite(reported) && reported > 0) {
                  testTotal = Math.max(testTotal, reported);
                  const percent =
                    testTotal > 0
                      ? Math.min(100, Math.round((testCurrent / testTotal) * 100))
                      : undefined;
                  if (percent !== undefined) {
                    updateProgress({
                      current: testCurrent,
                      total: testTotal,
                      percent,
                      label: `Tests ${testCurrent}/${testTotal}`,
                      updatedAt: new Date().toISOString(),
                    });
                  }
                }
              }
            }
          }

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

  /**
   * Expose builder name for logging/telemetry without widening protected access.
   */
  public describeBuilder(): string {
    return this.getBuilderName();
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
