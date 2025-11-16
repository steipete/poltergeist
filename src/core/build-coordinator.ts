import type { IntelligentBuildQueue } from '../build-queue.js';
import type { IStateManager } from '../interfaces.js';
import type { Logger } from '../logger.js';
import type { BuildNotifier } from '../notifier.js';
import type { BuildSchedulingConfig, Target } from '../types.js';
import { BuildStatusManager } from '../utils/build-status-manager.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import type { TargetState } from './target-state.js';

interface BuildCoordinatorDeps {
  projectRoot: string;
  logger: Logger;
  stateManager: IStateManager;
  notifier?: BuildNotifier;
  buildQueue?: IntelligentBuildQueue;
  buildSchedulingConfig: BuildSchedulingConfig;
}

/**
 * Encapsulates build execution and notifications so Poltergeist stays focused on orchestration.
 */
export class BuildCoordinator {
  private readonly projectRoot: string;
  private readonly logger: Logger;
  private readonly stateManager: IStateManager;
  private readonly notifier?: BuildNotifier;
  private readonly buildQueue?: IntelligentBuildQueue;
  private readonly buildSchedulingConfig: BuildSchedulingConfig;

  constructor({
    projectRoot,
    logger,
    stateManager,
    notifier,
    buildQueue,
    buildSchedulingConfig,
  }: BuildCoordinatorDeps) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.stateManager = stateManager;
    this.notifier = notifier;
    this.buildQueue = buildQueue;
    this.buildSchedulingConfig = buildSchedulingConfig;
  }

  public async performInitialBuilds(targetStates: Map<string, TargetState>): Promise<void> {
    if (this.buildQueue && this.buildSchedulingConfig.prioritization.enabled) {
      await Promise.all(
        Array.from(targetStates.values()).map((state) =>
          this.buildQueue?.queueTargetBuild(state.target, 'initial-build')
        )
      );
      return;
    }

    const buildPromises: Promise<void>[] = [];
    for (const [name, state] of targetStates) {
      const allFiles = await this.getAllWatchedFiles(state.target);
      for (const file of allFiles) {
        state.pendingFiles.add(file);
      }
      buildPromises.push(this.buildTarget(name, targetStates));
    }
    await Promise.all(buildPromises);
  }

  public async buildTarget(
    targetName: string,
    targetStates: Map<string, TargetState>
  ): Promise<void> {
    const state = targetStates.get(targetName);
    if (!state) return;

    const changedFiles = Array.from(state.pendingFiles);
    state.pendingFiles.clear();

    try {
      const buildOptions = {
        captureLogs: true,
        logFile: FileSystemUtils.getLogFilePath(this.projectRoot, state.target.name),
      };
      const status = await state.builder.build(changedFiles, buildOptions);
      state.lastBuild = status;

      if (state.runner) {
        if (BuildStatusManager.isSuccess(status)) {
          await state.runner.onBuildSuccess();
        } else if (BuildStatusManager.isFailure(status)) {
          state.runner.onBuildFailure(status);
        }
      }

      if (BuildStatusManager.isSuccess(status)) {
        state.postBuildRunner?.onBuildResult('success');
      } else if (BuildStatusManager.isFailure(status)) {
        state.postBuildRunner?.onBuildResult('failure');
      }

      if (this.notifier) {
        if (BuildStatusManager.isSuccess(status)) {
          const outputInfo = state.builder.getOutputInfo();
          const message = BuildStatusManager.formatNotificationMessage(status, outputInfo);
          await this.notifier.notifyBuildComplete(
            `${targetName} Built`,
            message,
            state.target.icon
          );
        } else if (BuildStatusManager.isFailure(status)) {
          const errorMessage = BuildStatusManager.getErrorMessage(status);
          await this.notifier.notifyBuildFailed(
            `${targetName} Failed`,
            errorMessage,
            state.target.icon
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${targetName}] Build error: ${errorMessage}`);

      const failureStatus = BuildStatusManager.createFailureStatus(
        targetName,
        { message: errorMessage, summary: 'Build threw before status update' },
        { duration: 0 },
        { gitHash: 'unknown', builder: state.builder.describeBuilder?.() || state.target.type }
      );
      state.lastBuild = failureStatus;
      await this.stateManager.updateBuildStatus(targetName, failureStatus);

      if (this.notifier) {
        await this.notifier.notifyBuildFailed(
          `${targetName} Error`,
          errorMessage,
          state.target.icon
        );
      }
    }
  }

  private async getAllWatchedFiles(_target: Target): Promise<string[]> {
    // TODO: Implement real file discovery; for now, trigger full build
    return [];
  }
}
