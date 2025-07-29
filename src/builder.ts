import { spawn, ChildProcess } from 'child_process';
import { writeFile } from 'fs/promises';
import { execSync } from 'child_process';
import path from 'path';
import chalk from 'chalk';
import { Logger } from 'winston';
import type { BuildTarget, BuildTargetConfig, BuildStatus, BuildResult } from './types.js';

export abstract class Builder {
  protected buildProcess?: ChildProcess;
  protected buildStartTime?: number;
  protected retryCount = 0;
  protected backoffDelay = 1000; // Start with 1 second

  constructor(
    protected target: BuildTarget,
    protected config: BuildTargetConfig,
    protected projectRoot: string,
    protected logger: Logger
  ) {}

  abstract build(): Promise<BuildResult>;
  abstract postBuild(result: BuildResult): Promise<void>;

  async writeBuildStatus(status: BuildStatus): Promise<void> {
    const statusPath = path.resolve(this.config.statusFile);
    await writeFile(statusPath, JSON.stringify(status, null, 4));
  }

  protected async getGitHash(): Promise<string> {
    try {
      return execSync('git rev-parse --short HEAD', {
        cwd: this.projectRoot,
        encoding: 'utf8',
      }).trim();
    } catch {
      return 'unknown';
    }
  }

  protected async runBuildCommand(): Promise<BuildResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';

      this.logger.info(`[${this.target}] 🔨 Building with: ${this.config.buildCommand}`);

      this.buildProcess = spawn(this.config.buildCommand, [], {
        cwd: this.projectRoot,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1' },
      });

      this.buildProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Stream output for real-time feedback
        process.stdout.write(data);
      });

      this.buildProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
        process.stderr.write(data);
      });

      this.buildProcess.on('close', (code) => {
        const duration = Date.now() - startTime;
        const success = code === 0;

        resolve({
          success,
          output: stdout + stderr,
          error: success ? undefined : stderr || stdout,
          duration,
          exitCode: code ?? undefined,
        });
      });

      this.buildProcess.on('error', (error) => {
        resolve({
          success: false,
          output: '',
          error: error.message,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  async cancelBuild(): Promise<void> {
    if (this.buildProcess && !this.buildProcess.killed) {
      this.logger.info(`[${this.target}] Cancelling build...`);
      
      // Kill the entire process tree
      try {
        if (process.platform === 'darwin') {
          execSync(`pkill -P ${this.buildProcess.pid}`, { encoding: 'utf8' });
        }
        this.buildProcess.kill('SIGTERM');
      } catch (error) {
        this.logger.warn(`Failed to kill build process: ${error}`);
      }
    }
  }

  protected extractErrorSummary(output: string): string {
    // Extract first few error lines from build output
    const errorLines = output
      .split('\n')
      .filter(line => 
        line.includes('error:') || 
        line.includes('Error:') ||
        line.includes('FAILED') ||
        line.includes('fatal:')
      )
      .slice(0, 3)
      .join(' ');

    return errorLines || 'Build failed with unknown error';
  }

  async handleRetry(): Promise<boolean> {
    if (this.retryCount >= this.config.maxRetries) {
      this.logger.warn(`[${this.target}] Max retries (${this.config.maxRetries}) reached`);
      return false;
    }

    this.retryCount++;
    const delay = this.backoffDelay;
    this.backoffDelay *= this.config.backoffMultiplier;

    this.logger.info(
      `[${this.target}] Retry ${this.retryCount}/${this.config.maxRetries} in ${delay}ms`
    );

    await new Promise(resolve => setTimeout(resolve, delay));
    return true;
  }

  resetRetry(): void {
    this.retryCount = 0;
    this.backoffDelay = 1000;
  }
}

export class CLIBuilder extends Builder {
  async build(): Promise<BuildResult> {
    const gitHash = await this.getGitHash();

    // Write building status
    await this.writeBuildStatus({
      status: 'building',
      timestamp: new Date().toISOString(),
      gitHash,
      errorSummary: '',
      builder: 'poltergeist',
    });

    const result = await this.runBuildCommand();

    // Write final status
    await this.writeBuildStatus({
      status: result.success ? 'success' : 'failed',
      timestamp: new Date().toISOString(),
      gitHash,
      errorSummary: result.success ? '' : this.extractErrorSummary(result.output),
      builder: 'poltergeist',
      buildTime: result.duration,
    });

    if (result.success) {
      this.logger.info(
        chalk.green(`[${this.target}] ✅ Build complete in ${(result.duration / 1000).toFixed(1)}s`)
      );
      this.resetRetry();
    } else {
      this.logger.error(
        chalk.red(`[${this.target}] ❌ Build failed after ${(result.duration / 1000).toFixed(1)}s`)
      );
    }

    return result;
  }

  async postBuild(_result: BuildResult): Promise<void> {
    // CLI doesn't need post-build actions
  }
}

export class MacAppBuilder extends Builder {
  async build(): Promise<BuildResult> {
    const gitHash = await this.getGitHash();

    // Write building status
    await this.writeBuildStatus({
      status: 'building',
      timestamp: new Date().toISOString(),
      gitHash,
      errorSummary: '',
      builder: 'poltergeist',
    });

    const result = await this.runBuildCommand();

    // Write final status
    await this.writeBuildStatus({
      status: result.success ? 'success' : 'failed',
      timestamp: new Date().toISOString(),
      gitHash,
      errorSummary: result.success ? '' : this.extractErrorSummary(result.output),
      builder: 'poltergeist',
      buildTime: result.duration,
    });

    if (result.success) {
      this.logger.info(
        chalk.green(`[${this.target}] ✅ Build complete in ${(result.duration / 1000).toFixed(1)}s`)
      );
      this.resetRetry();
    } else {
      this.logger.error(
        chalk.red(`[${this.target}] ❌ Build failed after ${(result.duration / 1000).toFixed(1)}s`)
      );
    }

    return result;
  }

  async postBuild(result: BuildResult): Promise<void> {
    if (!result.success || !this.config.autoRelaunch || !this.config.bundleId) {
      return;
    }

    this.logger.info(`[${this.target}] 🚀 Relaunching ${this.config.bundleId}...`);

    try {
      // Quit the app
      execSync(`osascript -e 'quit app id "${this.config.bundleId}"'`, {
        encoding: 'utf8',
      });

      // Wait a moment for the app to quit
      await new Promise(resolve => setTimeout(resolve, 500));

      // Launch the app
      execSync(`open -b ${this.config.bundleId}`, {
        encoding: 'utf8',
      });

      this.logger.info(chalk.green(`[${this.target}] ✅ App relaunched successfully`));
    } catch (error) {
      this.logger.warn(`[${this.target}] Failed to relaunch app: ${error}`);
    }
  }
}