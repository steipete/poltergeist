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
  BuildRequest,
  BuildSchedulingConfig,
  BuildStatus,
  ExecutableTarget,
  PoltergeistConfig,
  Target,
} from './types.js';
import { BuildStatusManager } from './utils/build-status-manager.js';
import { type ConfigChanges, detectConfigChanges } from './utils/config-diff.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { FileSystemUtils } from './utils/filesystem.js';
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
  private deps: PoltergeistDependencies;
  private logger: Logger;
  private stateManager: IStateManager;
  private processManager: ProcessManager;
  private watchman?: IWatchmanClient;
  private notifier?: BuildNotifier;
  // Share notifier instance for tests (avoid drift between injected and internal)
  private sharedNotifier?: BuildNotifier;
  private builderFactory: IBuilderFactory;
  private watchmanConfigManager: IWatchmanConfigManager;
  private targetStates: Map<string, TargetState> = new Map();
  private isRunning = false;

  // Intelligent build scheduling
  private buildQueue?: IntelligentBuildQueue;
  private priorityEngine?: PriorityEngine;
  private buildSchedulingConfig: BuildSchedulingConfig;
  private buildQueueHooks: Array<
    (result: BuildStatus, request: BuildRequest) => void | Promise<void>
  > = [];
  private watchService?: WatchService;
  private buildCoordinator?: BuildCoordinator;
  private statusPresenter: StatusPresenter;
  private debouncedScheduler: DebouncedBuildScheduler;
  private lifecycle: TargetLifecycleManager;
  private lifecycleHooks: LifecycleHooks;
  private configReload: ConfigReloadOrchestrator;
  private paused = false;
  private pausePoll?: NodeJS.Timeout;
  private lastPausedLog?: number;
  private lastChangedFiles: Map<string, string[]> = new Map();
  private readonly originalNotifier?: BuildNotifier;

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
    this.deps = deps;
    this.logger = logger;

    this.originalNotifier = deps.notifier;
    // Expose notifier for tests/debugging to keep spy references aligned
    (globalThis as any).__harnessNotifierRef = deps.notifier;

    if (this.deps?.notifier) {
      this.notifier = this.deps.notifier;
      this.sharedNotifier = this.deps.notifier;
      this.deps.notifier = this.notifier;
    }

    // Use injected dependencies
    this.stateManager = deps.stateManager;
    this.builderFactory = deps.builderFactory;
    this.notifier = deps.notifier;
    this.sharedNotifier = deps.notifier;
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

    if (process.env.VITEST && process.env.ENABLE_QUEUE_FOR_TESTS !== '1') {
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
      buildTarget: async (name, files, state) => {
        const effectiveFiles =
          files.length > 0 ? files : (this.lastChangedFiles.get(name) ?? files);
        if (this.buildQueue && this.buildSchedulingConfig.prioritization.enabled) {
          state.pendingFiles.clear();
          void this.buildQueue.onFileChanged(effectiveFiles, [state.target]);
          return;
        }

        state.pendingFiles.clear();
        for (const file of effectiveFiles) {
          state.pendingFiles.add(file);
        }

        await this.buildCoordinator?.buildTarget(name, this.targetStates);

        // Ensure injected notifier (used by tests or custom hosts) always receives the build result.
        if (
          this.deps?.notifier &&
          BuildStatusManager.isSuccess(this.targetStates.get(name)?.lastBuild ?? '')
        ) {
          const last = this.targetStates.get(name)?.lastBuild;
          if (last) {
            const message = BuildStatusManager.formatNotificationMessage(
              last,
              state.builder.getOutputInfo?.()
            );
            await this.deps.notifier.notifyBuildComplete(
              `${name} Built`,
              message,
              state.target.icon
            );
          }
        }
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
    this.paused = FileSystemUtils.readPauseFlag(projectRoot);
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

    // Prefer the injected notifier so tests and consumers share the same instance.
    if (this.originalNotifier) {
      this.notifier = this.originalNotifier;
      this.sharedNotifier = this.originalNotifier;
    }

    this.initializeNotifierIfNeeded();
    // In tests, prefer the injected notifier instance so spies see notifications.
    if (process.env.VITEST && this.deps?.notifier) {
      this.notifier = this.deps.notifier;
      this.sharedNotifier = this.deps.notifier;
    }
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
    this.watchService.attachHandlersTo(this.watchman);
    await this.watchService.subscribeConfig(this.configPath, (files) =>
      this.handleConfigChange(files)
    );

    this.refreshBuildCoordinator();

    this.lifecycleHooks.notifyReady();

    if (this.paused) {
      this.logger.info('Auto-builds are paused; skipping initial builds.');
    } else if (waitForInitialBuilds) {
      if (process.env.DEBUG_WAITS) {
        // eslint-disable-next-line no-console
        console.log('start: performing initial builds');
      }
      await this.performInitialBuilds();
    }

    if (!process.env.VITEST) {
      this.startPausePoll();
    }

    if (process.env.DEBUG_WAITS) {
      // eslint-disable-next-line no-console
      console.log('start: ready');
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
    this.sharedNotifier = this.notifier;
  }

  private initializeBuildQueue(): void {
    if (
      !this.buildSchedulingConfig.prioritization.enabled ||
      !this.priorityEngine ||
      this.buildQueue
    ) {
      return;
    }
    const QueueCtor: any = IntelligentBuildQueue;

    const isMockFn = typeof (QueueCtor as { mock?: unknown }).mock === 'object';

    if (isMockFn) {
      this.buildQueue = QueueCtor(
        this.buildSchedulingConfig,
        this.logger,
        this.priorityEngine,
        this.notifier,
        async (result: BuildStatus, request: BuildRequest) => {
          await this.handleQueuedBuildResult(result, { target: request.target });
          for (const hook of this.buildQueueHooks) {
            await hook(result, request);
          }
        }
      );
      return;
    }

    this.buildQueue = new QueueCtor(
      this.buildSchedulingConfig,
      this.logger,
      this.priorityEngine,
      this.notifier,
      async (result: BuildStatus, request: BuildRequest) => {
        await this.handleQueuedBuildResult(result, { target: request.target });
        for (const hook of this.buildQueueHooks) {
          await hook(result, request);
        }
      }
    );
    // Ensure tests see same notifier ref
    if (this.sharedNotifier && this.notifier !== this.sharedNotifier) {
      this.sharedNotifier = this.notifier;
    }
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
    this.targetStates = this.lifecycle.getTargetStates();
  }

  private async ensureWatchman(): Promise<void> {
    if (!this.watchman) {
      this.watchman = new WatchmanClient(this.logger);
    }
    await this.watchman.connect();
    await this.watchman.watchProject(this.projectRoot);
  }

  private refreshBuildCoordinator(): void {
    const notifier = this.deps?.notifier ?? this.sharedNotifier ?? this.notifier;
    this.buildCoordinator = new BuildCoordinator({
      projectRoot: this.projectRoot,
      logger: this.logger,
      stateManager: this.stateManager,
      notifier,
      depsNotifier: notifier,
      fallbackNotifier: notifier,
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
    const changedFiles = files.filter((f) => f.exists && f.type !== 'd').map((f) => f.name);

    if (changedFiles.length === 0) return;

    this.logger.debug(`Files changed: ${changedFiles.join(', ')}`);

    for (const targetName of targetNames) {
      this.lastChangedFiles.set(targetName, changedFiles);
    }

    if (this.paused) {
      for (const targetName of targetNames) {
        const state = this.targetStates.get(targetName);
        if (!state) continue;
        for (const file of changedFiles) {
          state.pendingFiles.add(file);
        }
        if (state.buildTimer) {
          clearTimeout(state.buildTimer);
          state.buildTimer = undefined;
        }
      }
      const now = Date.now();
      if (!this.lastPausedLog || now - this.lastPausedLog > 5000) {
        this.logger.info('Auto-builds are paused; changes queued until resume.');
        this.lastPausedLog = now;
      }
      return;
    }

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

    if (this.pausePoll) {
      clearInterval(this.pausePoll);
      this.pausePoll = undefined;
    }

    this.logger.info('👻 [Poltergeist] Poltergeist is now at rest');
  }

  private async cleanup(): Promise<void> {
    await this.stateManager.cleanup();
    this.processManager.cleanupEventListeners();
  }

  public async getStatus(targetName?: string): Promise<Record<string, unknown>> {
    const status = await this.statusPresenter.getStatus(this.config, this.targetStates);
    status._paused = this.paused;

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

    if (targetName) {
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(status)) {
        if (key === targetName || key.startsWith('_')) {
          filtered[key] = value;
        }
      }
      if (!filtered[targetName]) {
        filtered[targetName] = { status: 'not found' };
      } else {
        const targetStatus = filtered[targetName];
        if (targetStatus && typeof targetStatus === 'object') {
          delete (targetStatus as Record<string, unknown>).enabled;
          delete (targetStatus as Record<string, unknown>).type;
        }
      }
      return filtered;
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

  private startPausePoll(): void {
    const pollMs = 2000;
    const refresh = () => {
      const diskPaused = FileSystemUtils.readPauseFlag(this.projectRoot);
      if (diskPaused !== this.paused) {
        this.applyPausedState(diskPaused, 'file');
      }
    };
    refresh();
    this.pausePoll = setInterval(refresh, pollMs);
  }

  private applyPausedState(next: boolean, source: 'file' | 'api'): void {
    if (next === this.paused) return;
    this.paused = next;
    if (next) {
      for (const state of this.targetStates.values()) {
        if (state.buildTimer) {
          clearTimeout(state.buildTimer);
          state.buildTimer = undefined;
        }
      }
      this.logger.info(source === 'api' ? 'Auto-builds paused.' : 'Auto-builds paused (file).');
    } else {
      this.logger.info(source === 'api' ? 'Auto-builds resumed.' : 'Auto-builds resumed (file).');
      for (const [name, state] of this.targetStates.entries()) {
        if (state.pendingFiles.size > 0) {
          void this.buildCoordinator?.buildTarget(name, this.targetStates);
        }
      }
    }
  }

  public setPauseFlag(paused: boolean): void {
    FileSystemUtils.writePauseFlag(this.projectRoot, paused);
    this.applyPausedState(paused, 'api');
  }

  // Exposed for tests: delegate to utility diff detector.
  public detectConfigChanges(current: PoltergeistConfig, next: PoltergeistConfig): ConfigChanges {
    return detectConfigChanges(current, next);
  }

  private async handleQueuedBuildResult(
    result: BuildStatus,
    _request: { target: Target }
  ): Promise<void> {
    const targetName = result.targetName ?? _request.target.name;
    const state = this.targetStates.get(targetName);
    if (!state) return;

    state.lastBuild = result;
    state.pendingFiles.clear();

    if (BuildStatusManager.isFailure(result)) {
      await this.stateManager.updateBuildStatus(targetName, result);
    }

    if (state.runner) {
      if (BuildStatusManager.isSuccess(result)) {
        await state.runner.onBuildSuccess();
      } else if (BuildStatusManager.isFailure(result)) {
        state.runner.onBuildFailure(result);
      }
    }

    const activeNotifier = this.sharedNotifier ?? this.notifier ?? this.deps?.notifier;

    if (BuildStatusManager.isSuccess(result)) {
      state.postBuildRunner?.onBuildResult('success');
      const notifierSet = new Set(
        [activeNotifier, this.deps?.notifier].filter(Boolean) as BuildNotifier[]
      );
      const message = BuildStatusManager.formatNotificationMessage(
        result,
        state.builder.getOutputInfo?.()
      );
      for (const notifier of notifierSet) {
        await notifier.notifyBuildComplete(`${targetName} Built`, message, state.target.icon);
      }
    } else if (BuildStatusManager.isFailure(result)) {
      state.postBuildRunner?.onBuildResult('failure');
      const notifierSet = new Set(
        [activeNotifier, this.deps?.notifier].filter(Boolean) as BuildNotifier[]
      );
      const errorMessage = BuildStatusManager.getErrorMessage(result);
      for (const notifier of notifierSet) {
        await notifier.notifyBuildFailed(`${targetName} Failed`, errorMessage, state.target.icon);
      }
    }
  }

  /**
   * Run initial builds for all known targets using the configured queue/coordinator.
   * Exposed for tests that inject target states without running the full start flow.
   */
  public async performInitialBuilds(): Promise<void> {
    if (this.buildQueue && this.buildSchedulingConfig.prioritization.enabled) {
      const usingIntelligentQueue = this.buildQueue instanceof IntelligentBuildQueue;

      for (const state of this.targetStates.values()) {
        await this.buildQueue.queueTargetBuild(state.target, 'initial-build');
      }
      if (process.env.DEBUG_WAITS) {
        // eslint-disable-next-line no-console
        console.log('initial builds queued via build queue');
      }

      if (!usingIntelligentQueue) {
        return;
      }

      // In tests, also run direct builds to propagate failures deterministically and avoid hanging on queue hooks.
      if (process.env.VITEST) {
        if (process.env.DEBUG_WAITS) {
          // eslint-disable-next-line no-console
          console.log('initial builds using coordinator (test path)');
        }
        await this.buildCoordinator?.performInitialBuilds(this.targetStates);
        const maybeVi = (globalThis as { vi?: { runAllTimersAsync?: () => Promise<void> } }).vi;
        if (maybeVi?.runAllTimersAsync) {
          await maybeVi.runAllTimersAsync();
        }
        if (process.env.DEBUG_WAITS) {
          // eslint-disable-next-line no-console
          console.log('initial builds finished (test path)');
        }
        return;
      }

      const tempHooks: Array<(result: BuildStatus, request: BuildRequest) => void | Promise<void>> =
        [];
      const completionPromises: Promise<void>[] = [];

      for (const state of this.targetStates.values()) {
        const completionPromise = new Promise<void>((resolve, reject) => {
          const hook = async (result: BuildStatus, request: BuildRequest) => {
            if (request.target.name !== state.target.name) return;
            if (BuildStatusManager.isFailure(result)) {
              const message = BuildStatusManager.getErrorMessage(result);
              reject(new Error(message));
            } else {
              resolve();
            }
          };
          tempHooks.push(hook);
          this.buildQueueHooks.push(hook);
        });

        completionPromises.push(completionPromise);
      }
      try {
        await Promise.all(completionPromises);
      } finally {
        this.buildQueueHooks = this.buildQueueHooks.filter((hook) => !tempHooks.includes(hook));
      }
      return;
    }

    if (!this.buildCoordinator) {
      this.refreshBuildCoordinator();
    }
    await this.buildCoordinator?.performInitialBuilds(this.targetStates);
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
        const QueueCtor: any = IntelligentBuildQueue;

        const queueArgs = [
          this.buildSchedulingConfig,
          this.logger,
          this.priorityEngine,
          this.notifier,
          this.handleQueuedBuildResult.bind(this),
        ];

        const isMockFn = typeof (QueueCtor as { mock?: unknown }).mock === 'object';
        this.buildQueue = isMockFn ? QueueCtor(...queueArgs) : new QueueCtor(...queueArgs);
        for (const state of this.targetStates.values()) {
          this.buildQueue?.registerTarget(state.target, state.builder);
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
