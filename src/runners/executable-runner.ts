import { type ChildProcess, spawn } from "child_process";
import type { Logger } from "../logger.js";
import type { BuildStatus, ExecutableTarget } from "../types.js";
import { LaunchPreparationError, prepareLaunchInfo } from "../utils/launch.js";

export interface ExecutableRunnerOptions {
  projectRoot: string;
  logger: Logger;
}

interface PendingLaunch {
  target: ExecutableTarget;
  readyAt: number;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class ExecutableRunner {
  private child: ChildProcess | null = null;
  private pendingLaunch?: PendingLaunch;
  private restarting = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(
    private target: ExecutableTarget,
    private readonly options: ExecutableRunnerOptions,
  ) {}

  public async updateTarget(target: ExecutableTarget): Promise<void> {
    this.target = target;
    if (!target.autoRun?.enabled) {
      this.cancelPendingLaunch();
      await this.stopChild("SIGTERM");
    }
  }

  public async onBuildSuccess(builtTarget = this.target): Promise<void> {
    if (!this.target.autoRun?.enabled || !builtTarget.autoRun?.enabled || this.shuttingDown) {
      return;
    }
    if (!this.child && !this.restarting && !this.pendingLaunch) {
      this.launch("initial-success", builtTarget);
      return;
    }
    // Keep ordinary rebuild coalescing, but give each new configuration its own deadline.
    const previous = this.pendingLaunch;
    this.pendingLaunch = {
      target: builtTarget,
      readyAt:
        previous?.target === builtTarget
          ? previous.readyAt
          : performance.now() + Math.max(0, builtTarget.autoRun?.restartDelayMs ?? 250),
    };
    if (this.restarting) return;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.scheduleRestart();
  }

  public onBuildFailure(status: BuildStatus): void {
    if (!this.target.autoRun?.enabled) {
      return;
    }
    this.options.logger.warn(
      `[${this.target.name}] Auto-run skipped due to build failure (${status.errorSummary ?? "unknown error"})`,
    );
  }

  public async stop(): Promise<void> {
    this.shuttingDown = true;
    this.cancelPendingLaunch();
    await this.stopChild("SIGTERM");
  }

  private cancelPendingLaunch(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.pendingLaunch = undefined;
  }

  private scheduleRestart(): void {
    if (!this.pendingLaunch) return;
    // Node turns larger timeouts into 1 ms timers; preserve long delays in bounded chunks.
    const restartDelay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, this.pendingLaunch.readyAt - performance.now()),
    );
    if (restartDelay === 0) {
      void this.performRestart();
      return;
    }
    this.restartTimer = setTimeout(() => {
      void this.performRestart();
    }, restartDelay);
  }

  private async performRestart(): Promise<void> {
    this.restartTimer = null;
    const pending = this.pendingLaunch;
    if (!pending || this.restarting) return;
    if (pending.readyAt > performance.now()) {
      this.scheduleRestart();
      return;
    }
    this.restarting = true;
    try {
      await this.stopChild((pending.target.autoRun?.restartSignal as NodeJS.Signals) ?? "SIGINT");
    } finally {
      this.restarting = false;
    }
    const latest = this.pendingLaunch;
    if (!latest) return;
    if (latest.readyAt > performance.now()) {
      this.scheduleRestart();
      return;
    }
    this.pendingLaunch = undefined;
    this.launch("rebuild", latest.target);
  }

  private launch(reason: string, target: ExecutableTarget): void {
    if (!this.target.autoRun?.enabled || this.shuttingDown) {
      return;
    }
    try {
      const launchInfo = this.resolveLaunchInfo(target);
      this.options.logger.info(
        `[${this.target.name}] Auto-run starting (${reason}) · ${launchInfo.command} ${launchInfo.commandArgs.join(" ")}`,
      );

      this.child = spawn(launchInfo.command, launchInfo.commandArgs, {
        cwd: this.options.projectRoot,
        stdio: "inherit",
        env: target.autoRun?.env ? { ...process.env, ...target.autoRun.env } : process.env,
      });

      const child = this.child;
      child.on("exit", (code, signal) => {
        if (this.child === child) this.child = null;
        if (!this.shuttingDown) {
          const status = signal ? `signal ${signal}` : `code ${code}`;
          this.options.logger.info(
            `[${this.target.name}] Auto-run process exited (${status}). Waiting for next successful build.`,
          );
        }
      });

      this.child.on("error", (error: Error) => {
        this.options.logger.error(
          `[${this.target.name}] Auto-run failed to start: ${error.message}`,
        );
      });
    } catch (error) {
      if (error instanceof LaunchPreparationError) {
        if (error.code === "NO_OUTPUT_PATH") {
          this.options.logger.error(
            `[${this.target.name}] Auto-run requires outputPath for executable targets`,
          );
        } else {
          this.options.logger.error(
            `[${this.target.name}] Auto-run binary missing: ${error.binaryPath ?? "<unknown>"}`,
          );
        }
      } else {
        this.options.logger.error(`[${this.target.name}] Auto-run launch error: ${error}`);
      }
    }
  }

  private resolveLaunchInfo(target: ExecutableTarget) {
    const args = target.autoRun?.args ?? [];
    if (target.autoRun?.command) {
      return {
        command: target.autoRun.command,
        commandArgs: args,
        binaryPath: target.autoRun.command,
      };
    }
    return prepareLaunchInfo(target, this.options.projectRoot, args);
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
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 5000);

      const exitHandler = () => {
        clearTimeout(forceKillTimer);
        child.removeListener("error", exitHandler);
        finalize();
      };

      child.once("exit", exitHandler);
      child.once("error", exitHandler);

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
