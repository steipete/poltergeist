import { IntelligentBuildQueue } from './build-queue.js';
import { BuildCoordinator } from './core/build-coordinator.js';
import { ConfigReloadOrchestrator } from './core/config-reload-orchestrator.js';
import { DebouncedBuildScheduler } from './core/debounced-build-scheduler.js';
import { LifecycleHooks } from './core/lifecycle-hooks.js';
import { StatusPresenter } from './core/status-presenter.js';
import { TargetLifecycleManager } from './core/target-lifecycle.js';
import type { TargetState } from './core/target-state.js';
import { WatchService } from './core/watch-service.js';
import type {
  IBuilderFactory,
  IStateManager,
  IWatchmanClient,
  IWatchmanConfigManager,
  PoltergeistDependencies,
} from './interfaces.js';
import { createLogger, type Logger } from './logger.js';
import { BuildNotifier } from './notifier.js';
import { PostBuildRunner } from './post-build/post-build-runner.js';
import { PriorityEngine } from './priority-engine.js';
import { ExecutableRunner } from './runners/executable-runner.js';
import { type PoltergeistState, StateManager } from './state.js';
import type {
  BuildSchedulingConfig,
  ExecutableTarget,
  PoltergeistConfig,
  Target,
} from './types.js';
import type { ConfigChanges } from './utils/config-diff.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { ProcessManager } from './utils/process-manager.js';
import { WatchmanClient } from './watchman.js';
import { WatchmanConfigManager } from './watchman-config.js';

export interface PoltergeistStartOptions {
  waitForInitialBuilds?: boolean;
}

export class Poltergeist {
  private config: PoltergeistConfig;
  private projectRoot: string;
  private configPath?: string;
  private logger: Logger;
  private stateManager: IStateManager;
  private processManager: ProcessManager;
  private watchman?: IWatchmanClient;
  private notifier?: BuildNotifier;
  private builderFactory: IBuilderFactory;
  private watchmanConfigManager: IWatchmanConfigManager;
  private targetStates: Map<string, TargetState> = new Map();
  private isRunning = false;

  // Intelligent build scheduling
  private buildQueue?: IntelligentBuildQueue;
  private priorityEngine?: PriorityEngine;
  private buildSchedulingConfig: BuildSchedulingConfig;
  private watchService?: WatchService;
  private buildCoordinator?: BuildCoordinator;
  private statusPresenter: StatusPresenter;
  private debouncedScheduler: DebouncedBuildScheduler;
  private lifecycle: TargetLifecycleManager;
  private lifecycleHooks: LifecycleHooks;
  private configReload: ConfigReloadOrchestrator;

  constructor(
    config: PoltergeistConfig,
    projectRoot: string,
    logger: Logger,
    deps: PoltergeistDependencies,
    configPath?: string
  ) {
    this.config = config;
    this.projectRoot = projectRoot;
    this.configPath = configPath;
    this.logger = logger;

    // Use injected dependencies
    this.stateManager = deps.stateManager;
    this.builderFactory = deps.builderFactory;
    this.notifier = deps.notifier;
    this.watchman = deps.watchmanClient;
    this.watchmanConfigManager =
      deps.watchmanConfigManager || new WatchmanConfigManager(projectRoot, logger);

    // Initialize ProcessManager for shutdown handling
    this.processManager = new ProcessManager(
      () => {}, // No heartbeat callback needed here (StateManager handles it)
      {},
      logger
    );

    // Initialize build scheduling configuration with defaults
    this.buildSchedulingConfig = {
      parallelization: 2,
      prioritization: {
        enabled: true,
        focusDetectionWindow: 300000, // 5 minutes
        priorityDecayTime: 1800000, // 30 minutes
        buildTimeoutMultiplier: 2.0,
      },
      ...config.buildScheduling,
    };

    if (process.env.VITEST) {
      // Disable priority engine in tests to exercise simpler debounce path and stable assertions
      this.buildSchedulingConfig.prioritization.enabled = false;
    }

    // Initialize priority engine if needed - build queue will be initialized later in start()
    if (this.buildSchedulingConfig.prioritization.enabled) {
      this.priorityEngine = new PriorityEngine(this.buildSchedulingConfig, logger);
    }

    this.statusPresenter = new StatusPresenter({
      logger: this.logger,
      stateManager: this.stateManager,
    });

    this.debouncedScheduler = new DebouncedBuildScheduler({
      defaultDelayMs: this.config.watchman?.settlingDelay || 1000,
      buildTarget: (name) => {
        void this.buildCoordinator?.buildTarget(name, this.targetStates);
      },
    });

    this.lifecycle = new TargetLifecycleManager({
      projectRoot,
      logger: this.logger,
      stateManager: this.stateManager,
      builderFactory: this.builderFactory,
    });

    this.lifecycleHooks = new LifecycleHooks({ logger: this.logger });
    this.configReload = new ConfigReloadOrchestrator({ configPath });
  }

  /**
   * Get the state manager instance
   */
  public getStateManager(): IStateManager {
    return this.stateManager;
  }

  public onReady(handler: () => void): void {
    this.lifecycleHooks.onReady(handler);
  }

  public async start(targetName?: string, options?: PoltergeistStartOptions): Promise<void> {
    const waitForInitialBuilds = options?.waitForInitialBuilds ?? true;
    if (this.isRunning) {
      throw new Error('Poltergeist is already running');
    }

    this.isRunning = true;
    this.logger.info('Starting Poltergeist...');

    this.stateManager.startHeartbeat();
    await this.setupWatchmanConfig();

    this.initializeNotifierIfNeeded();
    this.initializeBuildQueue();

    const targetsToWatch = this.getTargetsToWatch(targetName);
    this.logTargetsToWatch(targetsToWatch.length);
    await this.initializeTargetStates(targetsToWatch);

    await this.ensureWatchman();

    this.watchService = new WatchService({
      projectRoot: this.projectRoot,
      config: this.config,
      logger: this.logger,
      watchman: this.watchman,
      watchmanConfigManager: this.watchmanConfigManager,
      onFilesChanged: (files, targetNames) => this.handleFileChanges(files, targetNames),
    });

    await this.watchService.subscribeTargets(this.targetStates);
    await this.watchService.subscribeConfig(this.configPath, (files) =>
      this.handleConfigChange(files)
    );

    this.buildCoordinator = new BuildCoordinator({
      projectRoot: this.projectRoot,
      logger: this.logger,
      stateManager: this.stateManager,
      notifier: this.notifier,
      buildQueue: this.buildQueue,
      buildSchedulingConfig: this.buildSchedulingConfig,
    });

    this.lifecycleHooks.notifyReady();

    const initialBuilds = this.buildCoordinator.performInitialBuilds(this.targetStates);
    if (waitForInitialBuilds) {
      await initialBuilds;
    } else {
      initialBuilds.catch((error) => {
        this.logger.error('Initial builds failed while running in background:', error);
      });
    }

    this.logger.info('👻 [Poltergeist] is now watching for changes...');

    this.processManager.registerShutdownHandlers(async () => {
      await this.stop();
      await this.cleanup();
    });
  }

  private getTargetsToWatch(targetName?: string): Target[] {
    if (targetName) {
      const target = ConfigurationManager.findTarget(this.config, targetName);
      if (!target) {
        throw new Error(`Target '${targetName}' not found`);
      }
      if (!target.enabled) {
        throw new Error(`Target '${targetName}' is disabled`);
      }
      return [target];
    }

    // Return all enabled targets
    return this.config.targets.filter((t) => t.enabled);
  }

  private initializeNotifierIfNeeded(): void {
    if (this.config.notifications?.enabled === false || this.notifier) {
      return;
    }
    this.notifier = new BuildNotifier({
      enabled: this.config.notifications?.enabled ?? true,
      successSound: this.config.notifications?.successSound,
      failureSound: this.config.notifications?.failureSound,
    });
  }

  private initializeBuildQueue(): void {
    if (
      !this.buildSchedulingConfig.prioritization.enabled ||
      !this.priorityEngine ||
      this.buildQueue
    ) {
      return;
    }
    this.buildQueue = new IntelligentBuildQueue(
      this.buildSchedulingConfig,
      this.logger,
      this.priorityEngine,
      this.notifier
    );
  }

  private logTargetsToWatch(count: number): void {
    if (count === 0) {
      this.logger.warn('⚠️ No enabled targets found. Daemon will continue running.');
      this.logger.info('💡 You can enable targets by editing poltergeist.config.json');
    } else {
      this.logger.info(`👻 [Poltergeist] Building ${count} enabled target(s)`);
    }
  }

  private async initializeTargetStates(targets: Target[]): Promise<void> {
    await this.lifecycle.initTargets(targets, this.buildQueue);
  }

  private async ensureWatchman(): Promise<void> {
    if (!this.watchman) {
      this.watchman = new WatchmanClient(this.logger);
    }
    await this.watchman.connect();
    await this.watchman.watchProject(this.projectRoot);
  }

  private refreshBuildCoordinator(): void {
    this.buildCoordinator = new BuildCoordinator({
      projectRoot: this.projectRoot,
      logger: this.logger,
      stateManager: this.stateManager,
      notifier: this.notifier,
      buildQueue: this.buildQueue,
      buildSchedulingConfig: this.buildSchedulingConfig,
    });
  }

  /**
   * Setup Watchman configuration - no backwards compatibility
   */
  private async setupWatchmanConfig(): Promise<void> {
    this.logger.info('🔧 Setting up Watchman configuration...');

    try {
      // Strict validation - fail fast if config is invalid
      await this.watchmanConfigManager.ensureConfigUpToDate(this.config);

      // Suggest optimizations if available
      const suggestions = await this.watchmanConfigManager.suggestOptimizations();
      if (suggestions.length > 0) {
        this.logger.info('💡 Optimization suggestions:');
        suggestions.forEach((s) => {
          this.logger.info(`  • ${s}`);
        });
      }
    } catch (error) {
      this.logger.error('❌ Watchman configuration setup failed');
      throw error; // Fail fast - no fallbacks
    }
  }

  private handleFileChanges(
    files: Array<{ name: string; exists: boolean; type?: string }>,
    targetNames: string[]
  ): void {
    const changedFiles = files.filter((f) => f.exists).map((f) => f.name);

    if (changedFiles.length === 0) return;

    this.logger.debug(`Files changed: ${changedFiles.join(', ')}`);

    // Use intelligent build queue if available
    if (this.buildQueue && this.buildSchedulingConfig.prioritization.enabled) {
      const affectedTargets = targetNames
        .map((name) => this.targetStates.get(name)?.target)
        .filter((target): target is Target => target !== undefined);

      this.buildQueue.onFileChanged(changedFiles, affectedTargets);
      return;
    }

    // Fallback to traditional immediate builds
    this.debouncedScheduler.schedule(changedFiles, targetNames, this.targetStates);
  }

  public async stop(targetName?: string): Promise<void> {
    this.logger.info('👻 [Poltergeist] Putting Poltergeist to rest...');

    if (targetName) {
      // Stop specific target
      const state = this.targetStates.get(targetName);
      if (state) {
        await state.runner?.stop();
        await state.postBuildRunner?.stop();
        state.builder.stop();
        this.targetStates.delete(targetName);
        await this.stateManager.removeState(targetName);
        await this.watchService?.unsubscribeTargets([targetName]);
      }
    } else {
      // Stop all targets
      for (const state of this.targetStates.values()) {
        await state.runner?.stop();
        await state.postBuildRunner?.stop();
        state.builder.stop();
      }
      this.targetStates.clear();

      await this.watchService?.stop();
      this.watchService = undefined;
      this.watchman = undefined;

      // Cleanup state manager
      await this.stateManager.cleanup();

      this.isRunning = false;
    }

    this.logger.info('👻 [Poltergeist] Poltergeist is now at rest');
  }

  private async cleanup(): Promise<void> {
    await this.stateManager.cleanup();
    this.processManager.cleanupEventListeners();
  }

  public async getStatus(targetName?: string): Promise<Record<string, unknown>> {
    const status = await this.statusPresenter.getStatus(this.config, this.targetStates);

    if (this.buildQueue && this.buildSchedulingConfig.prioritization.enabled) {
      status._buildQueue = {
        enabled: true,
        config: this.buildSchedulingConfig,
        queue: this.buildQueue.getQueueStatus(),
        priority: this.buildQueue.getPriorityInfo(),
      };
    } else {
      status._buildQueue = {
        enabled: false,
        config: this.buildSchedulingConfig,
      };
    }

    if (targetName && !status[targetName]) {
      status[targetName] = { status: 'not found' };
    }

    return status;
  }

  /**
   * Handle configuration file changes for automatic reloading
   */
  private async handleConfigChange(files: Array<{ name: string; exists: boolean }>): Promise<void> {
    const configChanged = files.some((f) => f.name === 'poltergeist.config.json' && f.exists);
    if (!configChanged || !this.configPath) return;

    this.logger.info('🔄 Configuration file changed, reloading...');

    try {
      const result = await this.configReload.reloadConfig(this.config);
      if (!result) return;
      await this.applyConfigChanges(result.config, result.changes);
      this.config = result.config;
      this.logger.info('✅ Configuration reloaded successfully');
    } catch (error) {
      this.logger.error(
        `❌ Failed to reload configuration: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Apply detected configuration changes without a full restart.
   * Focuses on additions/removals and reconfiguring schedulers/notifiers.
   */
  public async applyConfigChanges(
    newConfig: PoltergeistConfig,
    changes: ConfigChanges
  ): Promise<void> {
    // Handle target removals
    for (const name of changes.targetsRemoved) {
      try {
        this.logger.info(`➖ Removing target: ${name}`);
        this.targetStates.delete(name);
        await this.stateManager.removeState(name);
      } catch (error) {
        this.logger.error(
          `❌ Failed to remove target ${name}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    // Handle target additions
    for (const target of changes.targetsAdded) {
      if (target.type !== 'executable') {
        this.logger.info(`ℹ️ Skipping non-executable target addition: ${target.name}`);
        continue;
      }
      try {
        this.logger.info(`➕ Adding target: ${target.name}`);
        const builder = this.builderFactory.createBuilder(
          target,
          this.projectRoot,
          this.logger,
          this.stateManager
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

        if (this.buildQueue) {
          this.buildQueue.registerTarget(target, builder);
        }

        await this.stateManager.initializeState(target);
      } catch (error) {
        this.logger.error(
          `❌ Failed to add target ${target.name}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    // Handle target modifications (simplified: replace definitions)
    for (const mod of changes.targetsModified) {
      if (mod.newTarget.type !== 'executable') {
        this.logger.info(`ℹ️ Skipping non-executable target update: ${mod.name}`);
        continue;
      }
      this.logger.info(`♻️ Updating target: ${mod.name}`);
      const previous = this.targetStates.get(mod.name);
      const builder = previous?.builder
        ? previous.builder
        : this.builderFactory.createBuilder(
            mod.newTarget,
            this.projectRoot,
            this.logger,
            this.stateManager
          );
      const runner = previous?.runner
        ? previous.runner
        : new ExecutableRunner(mod.newTarget as ExecutableTarget, {
            projectRoot: this.projectRoot,
            logger: this.logger,
          });
      this.targetStates.set(mod.name, {
        target: mod.newTarget,
        builder,
        watching: previous?.watching ?? false,
        pendingFiles: previous?.pendingFiles ?? new Set(),
        runner,
        postBuildRunner: previous?.postBuildRunner,
      });

      if (this.buildQueue) {
        this.buildQueue.registerTarget(mod.newTarget, builder);
      }
    }

    // Apply other config changes
    if (changes.notificationsChanged) {
      const notifications = {
        enabled: false,
        buildStart: false,
        buildFailed: true,
        buildSuccess: true,
        ...newConfig.notifications,
      };
      this.notifier = new BuildNotifier(notifications);
      this.refreshBuildCoordinator();
    }

    if (changes.buildSchedulingChanged) {
      this.buildSchedulingConfig = {
        parallelization: 2,
        prioritization: {
          enabled: true,
          focusDetectionWindow: 300000,
          priorityDecayTime: 1800000,
          buildTimeoutMultiplier: 2.0,
        },
        ...newConfig.buildScheduling,
      };
      this.priorityEngine = this.buildSchedulingConfig.prioritization.enabled
        ? new PriorityEngine(this.buildSchedulingConfig, this.logger)
        : undefined;

      if (this.buildSchedulingConfig.prioritization.enabled && this.priorityEngine) {
        this.buildQueue = new IntelligentBuildQueue(
          this.buildSchedulingConfig,
          this.logger,
          this.priorityEngine,
          this.notifier
        );
        for (const state of this.targetStates.values()) {
          this.buildQueue.registerTarget(state.target, state.builder);
        }
      } else {
        this.buildQueue = undefined;
      }

      this.refreshBuildCoordinator();
    }

    // Update watchman config manager policies if needed
    if (changes.watchmanChanged) {
      await this.watchmanConfigManager.ensureConfigUpToDate(newConfig);
    }

    if (this.watchService) {
      if (changes.targetsRemoved.length > 0) {
        await this.watchService.unsubscribeTargets(changes.targetsRemoved);
      }
      await this.watchService.refreshTargets(this.targetStates);
    }
  }

  /**
   * List all Poltergeist state files across all projects
   */
  public static async listAllStates(): Promise<PoltergeistState[]> {
    const stateFiles = await StateManager.listAllStates();
    const states: PoltergeistState[] = [];

    for (const file of stateFiles) {
      try {
        const stateManager = new StateManager('/', createLogger());
        const targetName = file.replace('.state', '').split('-').pop() || '';
        const state = await stateManager.readState(targetName);
        if (state) {
          states.push(state);
        }
      } catch {
        // Ignore invalid state files
      }
    }

    return states;
  }
}
