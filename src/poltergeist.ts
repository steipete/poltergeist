// Poltergeist v1.0 - Clean, simple implementation
// Live testing: Poltergeist watching itself!

import { IntelligentBuildQueue } from './build-queue.js';
import type { BaseBuilder } from './builders/index.js';
import type {
  IBuilderFactory,
  IStateManager,
  IWatchmanClient,
  IWatchmanConfigManager,
  PoltergeistDependencies,
} from './interfaces.js';
import { createLogger, type Logger } from './logger.js';
import { BuildNotifier } from './notifier.js';
import { PriorityEngine } from './priority-engine.js';
import { ExecutableRunner } from './runners/executable-runner.js';
import { type PoltergeistState, StateManager } from './state.js';
import type {
  BuildSchedulingConfig,
  BuildStatus,
  ExecutableTarget,
  PoltergeistConfig,
  Target,
} from './types.js';
import { BuildStatusManager } from './utils/build-status-manager.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { FileSystemUtils } from './utils/filesystem.js';
import { expandGlobPatterns } from './utils/glob-utils.js';
import { ProcessManager } from './utils/process-manager.js';
import { WatchmanClient } from './watchman.js';
import { WatchmanConfigManager } from './watchman-config.js';

interface TargetState {
  target: Target;
  builder: BaseBuilder;
  watching: boolean;
  lastBuild?: BuildStatus;
  pendingFiles: Set<string>;
  buildTimer?: NodeJS.Timeout;
  runner?: ExecutableRunner;
}

interface ConfigChanges {
  targetsAdded: Target[];
  targetsRemoved: string[];
  targetsModified: Array<{ name: string; oldTarget: Target; newTarget: Target }>;
  watchmanChanged: boolean;
  notificationsChanged: boolean;
  buildSchedulingChanged: boolean;
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

    // Initialize priority engine if needed - build queue will be initialized later in start()
    if (this.buildSchedulingConfig.prioritization.enabled) {
      this.priorityEngine = new PriorityEngine(this.buildSchedulingConfig, logger);
    }
  }

  /**
   * Get the state manager instance
   */
  public getStateManager(): IStateManager {
    return this.stateManager;
  }

  public async start(targetName?: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Poltergeist is already running');
    }

    this.isRunning = true;
    this.logger.info('Starting Poltergeist...');

    // Start heartbeat
    this.stateManager.startHeartbeat();

    // Setup Watchman configuration with exclusions
    await this.setupWatchmanConfig();

    // Initialize notifier if enabled and not already injected
    if (this.config.notifications?.enabled !== false && !this.notifier) {
      this.notifier = new BuildNotifier({
        enabled: this.config.notifications?.enabled ?? true,
        successSound: this.config.notifications?.successSound,
        failureSound: this.config.notifications?.failureSound,
      });
    }

    // Initialize intelligent build queue now that notifier is available
    if (
      this.buildSchedulingConfig.prioritization.enabled &&
      this.priorityEngine &&
      !this.buildQueue
    ) {
      this.buildQueue = new IntelligentBuildQueue(
        this.buildSchedulingConfig,
        this.logger,
        this.priorityEngine,
        this.notifier
      );
    }

    // Determine which targets to build
    const targetsToWatch = this.getTargetsToWatch(targetName);
    if (targetsToWatch.length === 0) {
      this.logger.warn('⚠️ No enabled targets found. Daemon will continue running.');
      this.logger.info('💡 You can enable targets by editing poltergeist.config.json');
      // Continue running to allow hot reload when targets are added
    } else {
      this.logger.info(`👻 [Poltergeist] Building ${targetsToWatch.length} enabled target(s)`);
    }

    // Initialize target states
    for (const target of targetsToWatch) {
      if (target.watchPaths?.length) {
        target.watchPaths = expandGlobPatterns(target.watchPaths);
      }
      const builder = this.builderFactory.createBuilder(
        target,
        this.projectRoot,
        this.logger,
        this.stateManager
      );
      await builder.validate();

      let runner: ExecutableRunner | undefined;
      if (target.type === 'executable' && target.autoRun?.enabled) {
        runner = new ExecutableRunner(target as ExecutableTarget, {
          projectRoot: this.projectRoot,
          logger: this.logger,
        });
      }

      this.targetStates.set(target.name, {
        target,
        builder,
        watching: false,
        pendingFiles: new Set(),
        runner,
      });

      // Register with intelligent build queue if enabled
      if (this.buildQueue) {
        this.buildQueue.registerTarget(target, builder);
      }

      // Initialize state file
      await this.stateManager.initializeState(target);
    }

    // Connect to Watchman
    if (!this.watchman) {
      this.watchman = new WatchmanClient(this.logger);
    }
    await this.watchman?.connect();

    // Watch the project
    await this.watchman?.watchProject(this.projectRoot);

    // Subscribe to file changes for each target
    await this.subscribeToChanges();

    // Do initial builds
    await this.performInitialBuilds();

    this.logger.info('👻 [Poltergeist] is now watching for changes...');

    // Handle graceful shutdown using ProcessManager
    this.processManager.registerShutdownHandlers(async () => {
      await this.stop();
      await this.cleanup();
    });
  }

  private getTargetsToWatch(targetName?: string): Target[] {
    if (targetName) {
      const target = this.config.targets.find((t) => t.name === targetName);
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

  private async subscribeToChanges(): Promise<void> {
    if (!this.watchman) return;

    // Group targets by their watch paths to optimize subscriptions
    const pathToTargets = new Map<string, Set<string>>();

    for (const [name, state] of this.targetStates) {
      this.logger.debug(
        `Target ${name} has ${state.target.watchPaths.length} watch paths: ${JSON.stringify(state.target.watchPaths)}`
      );
      for (const pattern of state.target.watchPaths) {
        this.logger.debug(`Processing watch path: ${pattern}`);
        if (!pathToTargets.has(pattern)) {
          pathToTargets.set(pattern, new Set());
        }
        pathToTargets.get(pattern)?.add(name);
      }
    }

    // Create subscriptions with strict validation
    for (const [pattern, targetNames] of pathToTargets) {
      this.logger.debug(`Creating subscription for pattern: "${pattern}"`);

      try {
        // Normalize and validate pattern
        const normalizedPattern = this.watchmanConfigManager.normalizeWatchPattern(pattern);
        this.watchmanConfigManager.validateWatchPattern(normalizedPattern);

        const subscriptionName = `poltergeist_${normalizedPattern.replace(/[^a-zA-Z0-9]/g, '_')}`;

        // Get optimized exclusion expressions (no fallbacks)
        const exclusionExpressions = this.watchmanConfigManager.createExclusionExpressions(
          this.config
        );

        await this.watchman.subscribe(
          this.projectRoot,
          subscriptionName,
          {
            expression: ['match', normalizedPattern, 'wholename'],
            fields: ['name', 'exists', 'type'],
          },
          (files) => {
            this.handleFileChanges(files, Array.from(targetNames));
          },
          exclusionExpressions
        );

        this.logger.info(`👻 Watching ${targetNames.size} target(s): ${normalizedPattern}`);
      } catch (error) {
        this.logger.error(`❌ Invalid watch pattern "${pattern}": ${error}`);
        throw error; // Fail fast - no pattern fixing
      }
    }

    // Subscribe to configuration file changes for automatic reloading
    if (this.configPath) {
      try {
        await this.watchman.subscribe(
          this.projectRoot,
          'poltergeist_config',
          {
            expression: ['match', 'poltergeist.config.json', 'wholename'],
            fields: ['name', 'exists', 'type'],
          },
          (files) => {
            this.handleConfigChange(files);
          }
        );
        this.logger.info('🔧 Watching configuration file for changes');
      } catch (error) {
        this.logger.warn(`⚠️ Failed to watch config file: ${error}`);
        // Don't fail startup if config watching fails
      }
    }
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
    for (const targetName of targetNames) {
      const state = this.targetStates.get(targetName);
      if (!state) continue;

      for (const file of changedFiles) {
        state.pendingFiles.add(file);
      }

      // Clear existing timer
      if (state.buildTimer) {
        clearTimeout(state.buildTimer);
      }

      // Set new timer with settling delay
      const delay = state.target.settlingDelay || this.config.watchman?.settlingDelay || 1000;

      state.buildTimer = setTimeout(() => {
        this.buildTarget(targetName);
      }, delay);
    }
  }

  private async performInitialBuilds(): Promise<void> {
    // Use intelligent build queue if available
    if (this.buildQueue && this.buildSchedulingConfig.prioritization.enabled) {
      // Trigger initial builds through the queue
      const allTargets = Array.from(this.targetStates.values()).map((state) => state.target);
      await this.buildQueue.onFileChanged(['initial build'], allTargets);
      return;
    }

    // Fallback to traditional builds
    const buildPromises: Promise<void>[] = [];

    for (const [name, state] of this.targetStates) {
      // Get all files matching watch patterns for initial build
      const allFiles = await this.getAllWatchedFiles(state.target);
      for (const file of allFiles) {
        state.pendingFiles.add(file);
      }

      buildPromises.push(this.buildTarget(name));
    }

    await Promise.all(buildPromises);
  }

  private async getAllWatchedFiles(_target: Target): Promise<string[]> {
    // In a real implementation, this would query the file system
    // For now, return empty array to trigger a full build
    return [];
  }

  private async buildTarget(targetName: string): Promise<void> {
    const state = this.targetStates.get(targetName);
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

      // Send notification
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

      if (this.notifier) {
        await this.notifier.notifyBuildFailed(
          `${targetName} Error`,
          errorMessage,
          state.target.icon
        );
      }
    }
  }

  public async stop(targetName?: string): Promise<void> {
    this.logger.info('👻 [Poltergeist] Putting Poltergeist to rest...');

    if (targetName) {
      // Stop specific target
      const state = this.targetStates.get(targetName);
      if (state) {
        await state.runner?.stop();
        state.builder.stop();
        this.targetStates.delete(targetName);
        await this.stateManager.removeState(targetName);
      }
    } else {
      // Stop all targets
      for (const state of this.targetStates.values()) {
        await state.runner?.stop();
        state.builder.stop();
      }
      this.targetStates.clear();

      // Disconnect from Watchman
      if (this.watchman) {
        await this.watchman.disconnect();
        this.watchman = undefined;
      }

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
    const status: Record<string, unknown> = {};

    if (targetName) {
      const state = this.targetStates.get(targetName);
      const stateFile = await this.stateManager.readState(targetName);

      if (state && stateFile) {
        const targetConfig = this.config.targets.find((t) => t.name === targetName);
        status[targetName] = {
          status: state.watching ? 'watching' : 'idle',
          process: stateFile.process,
          lastBuild: stateFile.lastBuild || state.lastBuild,
          appInfo: stateFile.appInfo,
          pendingFiles: state.pendingFiles.size,
          buildStats: stateFile.buildStats,
          buildCommand: targetConfig?.buildCommand,
        };
      } else if (stateFile) {
        const targetConfig = this.config.targets.find((t) => t.name === targetName);
        status[targetName] = {
          status: stateFile.process.isActive ? 'running' : 'stopped',
          process: stateFile.process,
          lastBuild: stateFile.lastBuild,
          appInfo: stateFile.appInfo,
          buildStats: stateFile.buildStats,
          buildCommand: targetConfig?.buildCommand,
        };
      } else {
        status[targetName] = { status: 'not found' };
      }
    } else {
      // Get status for all targets
      for (const target of this.config.targets) {
        const state = this.targetStates.get(target.name);
        const stateFile = await this.stateManager.readState(target.name);

        if (state && stateFile) {
          status[target.name] = {
            status: state.watching ? 'watching' : 'idle',
            enabled: target.enabled,
            type: target.type,
            process: stateFile.process,
            lastBuild: stateFile.lastBuild || state.lastBuild,
            appInfo: stateFile.appInfo,
            pendingFiles: state.pendingFiles.size,
            buildStats: stateFile.buildStats,
            buildCommand: target.buildCommand,
          };
        } else if (stateFile) {
          status[target.name] = {
            status: stateFile.process.isActive ? 'running' : 'stopped',
            enabled: target.enabled,
            type: target.type,
            process: stateFile.process,
            lastBuild: stateFile.lastBuild,
            appInfo: stateFile.appInfo,
            buildStats: stateFile.buildStats,
            buildCommand: target.buildCommand,
          };
        } else {
          status[target.name] = {
            status: 'not running',
            enabled: target.enabled,
            type: target.type,
          };
        }
      }
    }

    // Add intelligent build queue status if enabled
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
      // Reload configuration
      const newConfig = await ConfigurationManager.loadConfigFromPath(this.configPath);

      // Compare configs and determine what needs to be restarted
      const changes = this.detectConfigChanges(this.config, newConfig);

      // Apply changes
      await this.applyConfigChanges(newConfig, changes);

      this.config = newConfig;
      this.logger.info('✅ Configuration reloaded successfully');
    } catch (error) {
      this.logger.error(
        `❌ Failed to reload configuration: ${error instanceof Error ? error.message : error}`
      );
      // Continue with old config
    }
  }

  /**
   * Detect changes between old and new configuration
   */
  private detectConfigChanges(
    oldConfig: PoltergeistConfig,
    newConfig: PoltergeistConfig
  ): ConfigChanges {
    const changes: ConfigChanges = {
      targetsAdded: [],
      targetsRemoved: [],
      targetsModified: [],
      watchmanChanged: false,
      notificationsChanged: false,
      buildSchedulingChanged: false,
    };

    // Create maps for easier comparison
    const oldTargets = new Map(oldConfig.targets.map((t) => [t.name, t]));
    const newTargets = new Map(newConfig.targets.map((t) => [t.name, t]));

    // Find added targets
    for (const [name, target] of newTargets) {
      if (!oldTargets.has(name)) {
        changes.targetsAdded.push(target);
      }
    }

    // Find removed targets
    for (const [name] of oldTargets) {
      if (!newTargets.has(name)) {
        changes.targetsRemoved.push(name);
      }
    }

    // Find modified targets
    for (const [name, newTarget] of newTargets) {
      const oldTarget = oldTargets.get(name);
      if (oldTarget && !this.targetsEqual(oldTarget, newTarget)) {
        changes.targetsModified.push({ name, oldTarget, newTarget });
      }
    }

    // Check for other changes
    changes.watchmanChanged =
      JSON.stringify(oldConfig.watchman) !== JSON.stringify(newConfig.watchman);
    changes.notificationsChanged =
      JSON.stringify(oldConfig.notifications) !== JSON.stringify(newConfig.notifications);
    changes.buildSchedulingChanged =
      JSON.stringify(oldConfig.buildScheduling) !== JSON.stringify(newConfig.buildScheduling);

    return changes;
  }

  /**
   * Compare two targets for equality
   */
  private targetsEqual(target1: Target, target2: Target): boolean {
    // Deep comparison of target properties that affect builds
    return JSON.stringify(target1) === JSON.stringify(target2);
  }

  /**
   * Apply configuration changes gracefully
   */
  private async applyConfigChanges(
    newConfig: PoltergeistConfig,
    changes: ConfigChanges
  ): Promise<void> {
    this.logger.debug(
      `Applying config changes: ${changes.targetsAdded.length} added, ${changes.targetsRemoved.length} removed, ${changes.targetsModified.length} modified`
    );

    // Remove obsolete targets
    for (const targetName of changes.targetsRemoved) {
      this.logger.info(`🗑️ Removing target: ${targetName}`);
      await this.stop(targetName);
    }

    // Stop and remove modified targets (they'll be re-added with new config)
    for (const { name } of changes.targetsModified) {
      this.logger.info(`🔄 Updating target: ${name}`);
      await this.stop(name);
    }

    // Update global settings that affect the core system
    if (changes.buildSchedulingChanged) {
      this.logger.info('🔄 Updating build scheduling configuration');
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

      // Reinitialize priority engine if needed
      if (this.buildSchedulingConfig.prioritization.enabled && !this.priorityEngine) {
        this.priorityEngine = new PriorityEngine(this.buildSchedulingConfig, this.logger);
      }
    }

    if (changes.notificationsChanged) {
      this.logger.info('🔄 Updating notification settings');
      if (newConfig.notifications?.enabled !== false && !this.notifier) {
        this.notifier = new BuildNotifier({
          enabled: newConfig.notifications?.enabled ?? true,
          successSound: newConfig.notifications?.successSound,
          failureSound: newConfig.notifications?.failureSound,
        });
      } else if (newConfig.notifications?.enabled === false && this.notifier) {
        this.notifier = undefined;
      }
    }

    // Add new and modified targets
    const targetsToAdd = [
      ...changes.targetsAdded,
      ...changes.targetsModified.map((m) => m.newTarget),
    ];
    for (const target of targetsToAdd) {
      if (!target.enabled) {
        this.logger.debug(`Skipping disabled target: ${target.name}`);
        continue;
      }

      this.logger.info(`➕ Adding target: ${target.name}`);

      try {
        const builder = this.builderFactory.createBuilder(
          target,
          this.projectRoot,
          this.logger,
          this.stateManager
        );
        await builder.validate();

        let runner: ExecutableRunner | undefined;
        if (target.type === 'executable' && target.autoRun?.enabled) {
          runner = new ExecutableRunner(target as ExecutableTarget, {
            projectRoot: this.projectRoot,
            logger: this.logger,
          });
        }

        this.targetStates.set(target.name, {
          target,
          builder,
          watching: false,
          pendingFiles: new Set(),
          runner,
        });

        // Register with intelligent build queue if enabled
        if (this.buildQueue) {
          this.buildQueue.registerTarget(target, builder);
        }

        // Initialize state file
        await this.stateManager.initializeState(target);
      } catch (error) {
        this.logger.error(`❌ Failed to add target ${target.name}: ${error}`);
      }
    }

    // If we have target changes, we need to update file watching subscriptions
    if (
      changes.targetsAdded.length > 0 ||
      changes.targetsRemoved.length > 0 ||
      changes.targetsModified.length > 0
    ) {
      this.logger.info('🔄 Updating file watch subscriptions');

      // Unsubscribe from all existing subscriptions (except config)
      if (this.watchman) {
        // Note: This is a simplified approach. In a more sophisticated implementation,
        // we would track individual subscriptions and only update the ones that changed.
        try {
          await this.watchman.disconnect();
          await this.watchman.connect();
          await this.watchman.watchProject(this.projectRoot);
          await this.subscribeToChanges();
        } catch (error) {
          this.logger.error(`❌ Failed to update file watching: ${error}`);
        }
      }
    }

    // Update Watchman configuration if needed
    if (changes.watchmanChanged) {
      this.logger.info('🔄 Updating Watchman configuration');
      try {
        await this.setupWatchmanConfig();
      } catch (error) {
        this.logger.error(`❌ Failed to update Watchman config: ${error}`);
      }
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
