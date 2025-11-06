import { type ChildProcess, spawn } from 'child_process';
import type { Logger } from '../logger.js';
import type { BuildStatus, ExecutableTarget } from '../types.js';
import { LaunchPreparationError, prepareLaunchInfo } from '../utils/launch.js';

export interface ExecutableRunnerOptions {
  projectRoot: string;
  logger: Logger;
}

export class ExecutableRunner {
  private child: ChildProcess | null = null;
  private pendingRestart = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly restartSignal: NodeJS.Signals;
  private readonly restartDelay: number;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private readonly customCommand?: string;
  private shuttingDown = false;

  constructor(
    private readonly target: ExecutableTarget,
    private readonly options: ExecutableRunnerOptions
  ) {
    const cfg = target.autoRun ?? {};
    const restartSignal = cfg.restartSignal as NodeJS.Signals | undefined;
    this.restartSignal = restartSignal ?? 'SIGINT';
    this.restartDelay = Math.max(0, cfg.restartDelayMs ?? 250);
    this.args = Array.isArray(cfg.args) ? cfg.args : [];
    this.env = cfg.env;
    this.customCommand = cfg.command;
  }

  public async onBuildSuccess(): Promise<void> {
    if (!this.target.autoRun?.enabled) {
      return;
    }
    if (!this.child) {
      await this.launch('initial-success');
      return;
    }
    this.scheduleRestart();
  }

  public onBuildFailure(status: BuildStatus): void {
    if (!this.target.autoRun?.enabled) {
      return;
    }
    this.options.logger.warn(
      `[${this.target.name}] Auto-run skipped due to build failure (${status.errorSummary ?? 'unknown error'})`
    );
  }

  public async stop(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.pendingRestart = false;
    this.shuttingDown = true;
    await this.stopChild('SIGTERM');
  }

  private scheduleRestart(): void {
    if (this.pendingRestart) {
      return;
    }
    this.pendingRestart = true;
    if (this.restartDelay === 0) {
      void this.performRestart();
      return;
    }
    this.restartTimer = setTimeout(() => {
      void this.performRestart();
    }, this.restartDelay);
  }

  private async performRestart(): Promise<void> {
    this.pendingRestart = false;
    this.restartTimer = null;
    await this.stopChild(this.restartSignal);
    await this.launch('rebuild');
  }

  private async launch(reason: string): Promise<void> {
    if (!this.target.autoRun?.enabled || this.shuttingDown) {
      return;
    }
    try {
      const launchInfo = this.resolveLaunchInfo();
      this.options.logger.info(
        `[${this.target.name}] Auto-run starting (${reason}) · ${launchInfo.command} ${launchInfo.commandArgs.join(' ')}`
      );

      this.child = spawn(launchInfo.command, launchInfo.commandArgs, {
        cwd: this.options.projectRoot,
        stdio: 'inherit',
        env: this.env ? { ...process.env, ...this.env } : process.env,
      });

      this.child.on('exit', (code, signal) => {
        if (this.restartTimer) {
          clearTimeout(this.restartTimer);
          this.restartTimer = null;
        }
        this.pendingRestart = false;
        this.child = null;
        if (!this.shuttingDown) {
          const status = signal ? `signal ${signal}` : `code ${code}`;
          this.options.logger.info(
            `[${this.target.name}] Auto-run process exited (${status}). Waiting for next successful build.`
          );
        }
      });

      this.child.on('error', (error: Error) => {
        this.options.logger.error(
          `[${this.target.name}] Auto-run failed to start: ${error.message}`
        );
      });
    } catch (error) {
      if (error instanceof LaunchPreparationError) {
        if (error.code === 'NO_OUTPUT_PATH') {
          this.options.logger.error(
            `[${this.target.name}] Auto-run requires outputPath for executable targets`
          );
        } else {
          this.options.logger.error(
            `[${this.target.name}] Auto-run binary missing: ${error.binaryPath ?? '<unknown>'}`
          );
        }
      } else {
        this.options.logger.error(`[${this.target.name}] Auto-run launch error: ${error}`);
      }
    }
  }

  private resolveLaunchInfo() {
    if (this.customCommand) {
      return {
        command: this.customCommand,
        commandArgs: this.args,
        binaryPath: this.customCommand,
      };
    }
    return prepareLaunchInfo(this.target, this.options.projectRoot, this.args);
  }

  private stopChild(signal: NodeJS.Signals): Promise<void> {
    if (!this.child) {
      return Promise.resolve();
    }

    const childRef = this.child as ChildProcess;
    return new Promise((resolve) => {
      const child = childRef;

      const finalize = () => {
        if (this.child === child) {
          this.child = null;
        }
        resolve();
      };

      const forceKillTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);

      const exitHandler = () => {
        clearTimeout(forceKillTimer);
        child.removeListener('error', exitHandler);
        finalize();
      };

      child.once('exit', exitHandler);
      child.once('error', exitHandler);

      if (child.exitCode !== null || child.signalCode) {
        exitHandler();
        return;
      }

      if (!child.kill(signal)) {
        exitHandler();
      }
    });
  }
}
