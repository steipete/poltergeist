import type { IntelligentBuildQueue } from "../build-queue.js";
import type { IBuilderFactory, IStateManager } from "../interfaces.js";
import type { Logger } from "../logger.js";
import { PostBuildRunner } from "../post-build/post-build-runner.js";
import { ExecutableRunner } from "../runners/executable-runner.js";
import type { ExecutableTarget, Target } from "../types.js";
import { BuildStatusManager } from "../utils/build-status-manager.js";
import { expandGlobPatterns } from "../utils/glob-utils.js";
import type { TargetState } from "./target-state.js";

interface TargetLifecycleDeps {
  projectRoot: string;
  logger: Logger;
  stateManager: IStateManager;
  builderFactory: IBuilderFactory;
}

export class TargetLifecycleManager {
  private readonly projectRoot: string;
  private readonly logger: Logger;
  private readonly stateManager: IStateManager;
  private readonly builderFactory: IBuilderFactory;
  private readonly targetStates: Map<string, TargetState> = new Map();

  constructor(deps: TargetLifecycleDeps) {
    this.projectRoot = deps.projectRoot;
    this.logger = deps.logger;
    this.stateManager = deps.stateManager;
    this.builderFactory = deps.builderFactory;
  }

  public getTargetStates(): Map<string, TargetState> {
    return this.targetStates;
  }

  public async initTargets(targets: Target[], buildQueue?: IntelligentBuildQueue): Promise<void> {
    for (const target of targets) {
      if (target.watchPaths?.length) {
        target.watchPaths = expandGlobPatterns(target.watchPaths);
      }
      const builder = this.builderFactory.createBuilder(
        target,
        this.projectRoot,
        this.logger,
        this.stateManager,
      );

      await this.stateManager.initializeState(target);

      try {
        await builder.validate();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const failureStatus = BuildStatusManager.createFailureStatus(
          target.name,
          { message: errorMessage, summary: "Validation failed", type: "configuration" },
          { duration: 0 },
          { gitHash: "validation", builder: builder.describeBuilder?.() || target.type },
        );
        await this.stateManager.updateBuildStatus(target.name, failureStatus);
        this.logger.error(`[${target.name}] Validation failed: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      const runner =
        target.type === "executable"
          ? new ExecutableRunner(target as ExecutableTarget, {
              projectRoot: this.projectRoot,
              logger: this.logger,
            })
          : undefined;

      const postBuildRunner =
        target.postBuild && target.postBuild.length > 0
          ? new PostBuildRunner({
              targetName: target.name,
              hooks: target.postBuild,
              projectRoot: this.projectRoot,
              stateManager: this.stateManager,
              logger: this.logger,
            })
          : undefined;

      this.targetStates.set(target.name, {
        target,
        builder,
        watching: false,
        pendingFiles: new Set(),
        runner,
        postBuildRunner,
      });

      if (buildQueue) {
        buildQueue.registerTarget(target, builder);
      }
    }
  }

  public async addTargets(targets: Target[], buildQueue?: IntelligentBuildQueue): Promise<void> {
    for (const target of targets) {
      if (target.type !== "executable") {
        this.logger.info(`ℹ️ Skipping non-executable target addition: ${target.name}`);
        continue;
      }
      const builder = this.builderFactory.createBuilder(
        target,
        this.projectRoot,
        this.logger,
        this.stateManager,
      );

      const runner = new ExecutableRunner(target as ExecutableTarget, {
        projectRoot: this.projectRoot,
        logger: this.logger,
      });

      const postBuildRunner =
        target.postBuild && target.postBuild.length > 0
          ? new PostBuildRunner({
              targetName: target.name,
              hooks: target.postBuild,
              projectRoot: this.projectRoot,
              stateManager: this.stateManager,
              logger: this.logger,
            })
          : undefined;

      this.targetStates.set(target.name, {
        target,
        builder,
        watching: false,
        pendingFiles: new Set(),
        runner,
        postBuildRunner,
      });

      if (buildQueue) {
        buildQueue.registerTarget(target, builder);
      }

      await this.stateManager.initializeState(target);
    }
  }

  public async updateTargets(
    modifications: Array<{ name: string; newTarget: Target }>,
    buildQueue?: IntelligentBuildQueue,
    targetStates = this.targetStates,
  ): Promise<void> {
    for (const mod of modifications) {
      const previous = targetStates.get(mod.name);
      const typeChanged = previous && previous.target.type !== mod.newTarget.type;
      if (mod.newTarget.type !== "executable" && !typeChanged) {
        this.logger.info(`ℹ️ Skipping non-executable target update: ${mod.name}`);
        continue;
      }
      this.logger.info(`♻️ Updating target: ${mod.name}`);
      const builder =
        previous?.builder && !typeChanged
          ? previous.builder
          : this.builderFactory.createBuilder(
              mod.newTarget,
              this.projectRoot,
              this.logger,
              this.stateManager,
            );
      if (typeChanged) await builder.validate();
      const runner =
        mod.newTarget.type === "executable"
          ? (!typeChanged && previous?.runner) ||
            new ExecutableRunner(mod.newTarget, {
              projectRoot: this.projectRoot,
              logger: this.logger,
            })
          : undefined;
      const postBuildRunner = typeChanged
        ? mod.newTarget.postBuild?.length
          ? new PostBuildRunner({
              targetName: mod.name,
              hooks: mod.newTarget.postBuild,
              projectRoot: this.projectRoot,
              stateManager: this.stateManager,
              logger: this.logger,
            })
          : undefined
        : previous?.postBuildRunner;
      if (typeChanged) {
        await previous.runner?.stop();
        await previous.postBuildRunner?.stop();
        previous.builder.stop();
      } else {
        previous?.builder.updateTarget(mod.newTarget);
        if (mod.newTarget.type === "executable") {
          await previous?.runner?.updateTarget(mod.newTarget);
        }
      }
      const updatedState = {
        target: mod.newTarget,
        builder,
        watching: previous?.watching ?? false,
        pendingFiles: previous?.pendingFiles ?? new Set(),
        runner,
        postBuildRunner,
      };
      targetStates.set(mod.name, Object.assign(previous ?? {}, updatedState));

      if (buildQueue) {
        buildQueue.registerTarget(mod.newTarget, builder);
      }
    }
  }

  public async removeTargets(names: string[]): Promise<void> {
    for (const name of names) {
      try {
        this.logger.info(`➖ Removing target: ${name}`);
        this.targetStates.delete(name);
        await this.stateManager.removeState(name);
      } catch (error) {
        this.logger.error(
          `❌ Failed to remove target ${name}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  public async stopTargets(targetName?: string): Promise<void> {
    if (targetName) {
      const state = this.targetStates.get(targetName);
      if (state) {
        await state.runner?.stop();
        await state.postBuildRunner?.stop();
        state.builder.stop();
        this.targetStates.delete(targetName);
        await this.stateManager.removeState(targetName);
      }
      return;
    }

    for (const state of this.targetStates.values()) {
      await state.runner?.stop();
      await state.postBuildRunner?.stop();
      state.builder.stop();
    }
    this.targetStates.clear();
    await this.stateManager.cleanup();
  }
}
