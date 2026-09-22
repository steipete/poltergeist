import type { IStateManager } from "../interfaces.js";
import type { Logger } from "../logger.js";
import type { BuildNotifier } from "../notifier.js";
import type { Target } from "../types.js";
import { BuildStatusManager } from "../utils/build-status-manager.js";
import { FileSystemUtils } from "../utils/filesystem.js";
import type { TargetState } from "./target-state.js";
import { outputForBuild, targetForBuild } from "./build-context.js";

interface BuildCoordinatorDeps {
  projectRoot: string;
  logger: Logger;
  stateManager: IStateManager;
  notifier?: BuildNotifier;
  depsNotifier?: BuildNotifier;
  fallbackNotifier?: BuildNotifier;
}

/**
 * Encapsulates build execution and notifications so Poltergeist stays focused on orchestration.
 */
export class BuildCoordinator {
  private readonly projectRoot: string;
  private readonly logger: Logger;
  private readonly stateManager: IStateManager;
  private readonly notifier?: BuildNotifier;
  private readonly depsNotifier?: BuildNotifier;
  private readonly fallbackNotifier?: BuildNotifier;
  private readonly lastNotified: Map<string, string> = new Map();

  constructor({
    projectRoot,
    logger,
    stateManager,
    notifier,
    depsNotifier,
    fallbackNotifier,
  }: BuildCoordinatorDeps) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.stateManager = stateManager;
    this.notifier = notifier;
    this.depsNotifier = depsNotifier;
    this.fallbackNotifier = fallbackNotifier;
  }

  public async performInitialBuilds(targetStates: Map<string, TargetState>): Promise<void> {
    const buildPromises: Promise<void>[] = [];
    for (const [name, state] of targetStates) {
      const allFiles = await this.getAllWatchedFiles(state.target);
      for (const file of allFiles) {
        state.pendingFiles.add(file);
      }
      buildPromises.push(this.buildTarget(name, targetStates, true));
    }
    await Promise.all(buildPromises);
  }

  public async buildTarget(
    targetName: string,
    targetStates: Map<string, TargetState>,
    propagateError = false,
  ): Promise<void> {
    const state = targetStates.get(targetName);
    if (!state) return;
    const requestedTarget = state.target;
    const builder = state.builder;

    const changedFiles = Array.from(state.pendingFiles);
    state.pendingFiles.clear();

    try {
      const buildOptions = {
        captureLogs: true,
        logFile: FileSystemUtils.getLogFilePath(this.projectRoot, state.target.name),
      };
      if (process.env.DEBUG_WAITS) {
        // eslint-disable-next-line no-console
        console.log(`coordinator build start ${targetName}`);
      }
      const buildPromise = builder.build(changedFiles, buildOptions);
      const maybeVi = (
        globalThis as {
          vi?: { runAllTimersAsync?: () => Promise<void>; isFakeTimers?: () => boolean };
        }
      ).vi;
      if (maybeVi?.runAllTimersAsync && maybeVi.isFakeTimers?.()) {
        await maybeVi.runAllTimersAsync();
      }
      const status = await buildPromise;
      if (targetStates.get(targetName) !== state || state.builder !== builder) return;
      if (process.env.VITEST && process.env.DEBUG_WAITS) {
        // eslint-disable-next-line no-console
        console.log("coordinator status", status.status, status.errorSummary ?? status.error);
      }
      state.lastBuild = status;
      if (process.env.DEBUG_WAITS) {
        // eslint-disable-next-line no-console
        console.log(`coordinator build done ${targetName}`);
      }

      if (state.runner) {
        if (BuildStatusManager.isSuccess(status)) {
          const builtTarget = targetForBuild(status, requestedTarget);
          if (builtTarget.type === "executable") {
            await state.runner.onBuildSuccess(builtTarget);
          }
        } else if (BuildStatusManager.isFailure(status)) {
          state.runner.onBuildFailure(status);
        }
      }

      if (BuildStatusManager.isSuccess(status)) {
        state.postBuildRunner?.onBuildResult("success");
      } else if (BuildStatusManager.isFailure(status)) {
        state.postBuildRunner?.onBuildResult("failure");
      }

      const primaryNotifier = this.notifier ?? this.depsNotifier ?? this.fallbackNotifier;
      const notifierSet = new Set(
        [primaryNotifier, this.depsNotifier, this.fallbackNotifier].filter(
          Boolean,
        ) as BuildNotifier[],
      );

      if (notifierSet.size > 0) {
        const dedupeKey = `${status.status}:${BuildStatusManager.getErrorMessage(status) ?? status.timestamp}`;
        if (this.lastNotified.get(targetName) === dedupeKey) {
          return;
        }
        if (BuildStatusManager.isSuccess(status)) {
          const outputInfo = outputForBuild(status, () => state.builder.getOutputInfo());
          const message = BuildStatusManager.formatNotificationMessage(status, outputInfo);
          for (const notifier of notifierSet) {
            await notifier.notifyBuildComplete(`${targetName} Built`, message, state.target.icon);
          }
        } else if (BuildStatusManager.isFailure(status)) {
          const errorMessage = BuildStatusManager.getErrorMessage(status);
          for (const notifier of notifierSet) {
            await notifier.notifyBuildFailed(
              `${targetName} Failed`,
              errorMessage,
              state.target.icon,
            );
          }
        }
        this.lastNotified.set(targetName, dedupeKey);
      }
    } catch (error) {
      if (targetStates.get(targetName) !== state || state.builder !== builder) return;
      const logMessage = error instanceof Error ? error.toString() : String(error);
      const notifyMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Build failed for ${targetName}: ${logMessage}`);

      const failureStatus = BuildStatusManager.createFailureStatus(
        targetName,
        { message: notifyMessage, summary: "Build threw before status update" },
        { duration: 0 },
        { gitHash: "unknown", builder: state.builder.describeBuilder?.() || state.target.type },
      );
      state.lastBuild = failureStatus;
      await this.stateManager.updateBuildStatus(targetName, failureStatus);

      const notifierSet = new Set(
        [this.notifier, this.depsNotifier, this.fallbackNotifier].filter(
          Boolean,
        ) as BuildNotifier[],
      );
      const dedupeKey = `failure:${notifyMessage}`;
      if (this.lastNotified.get(targetName) !== dedupeKey) {
        for (const notifier of notifierSet) {
          await notifier.notifyBuildFailed(`${targetName} Error`, notifyMessage, state.target.icon);
        }
        this.lastNotified.set(targetName, dedupeKey);
      }

      if (propagateError) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  private async getAllWatchedFiles(_target: Target): Promise<string[]> {
    // TODO: Implement real file discovery; for now, trigger full build
    return [];
  }
}
