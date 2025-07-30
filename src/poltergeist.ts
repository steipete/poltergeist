// Core Poltergeist class with unified state management
import { PoltergeistConfig, Target, BuildStatus } from './types.js';
import { Logger, createLogger } from './logger.js';
import { WatchmanClient } from './watchman.js';
import { BaseBuilder } from './builders/index.js';
import { BuildNotifier } from './notifier.js';
import { StateManager, PoltergeistState } from './state.js';
import { 
  IWatchmanClient, 
  IStateManager, 
  IBuilderFactory, 
  PoltergeistDependencies 
} from './interfaces.js';

interface TargetState {
  target: Target;
  builder: BaseBuilder;
  watching: boolean;
  lastBuild?: BuildStatus;
  pendingFiles: Set<string>;
  buildTimer?: NodeJS.Timeout;
}

export class Poltergeist {
  private config: PoltergeistConfig;
  private projectRoot: string;
  private logger: Logger;
  private stateManager: IStateManager;
  private watchman?: IWatchmanClient;
  private notifier?: BuildNotifier;
  private builderFactory: IBuilderFactory;
  private targetStates: Map<string, TargetState> = new Map();
  private isRunning = false;

  constructor(
    config: PoltergeistConfig, 
    projectRoot: string, 
    logger: Logger,
    deps: PoltergeistDependencies
  ) {
    this.config = config;
    this.projectRoot = projectRoot;
    this.logger = logger;
    
    // Use injected dependencies
    this.stateManager = deps.stateManager!;
    this.builderFactory = deps.builderFactory!;
    this.notifier = deps.notifier;
    this.watchman = deps.watchmanClient;
  }

  public async start(targetName?: string): Promise<void> {
    if (this.isRunning) {
      throw new Error('Poltergeist is already running');
    }

    this.isRunning = true;
    this.logger.info('Starting Poltergeist...');

    // Start heartbeat
    this.stateManager.startHeartbeat();

    // Initialize notifier if enabled and not already injected
    if (this.config.notifications?.enabled && !this.notifier) {
      this.notifier = new BuildNotifier(
        this.config.notifications
      );
    }

    // Determine which targets to build
    const targetsToWatch = this.getTargetsToWatch(targetName);
    if (targetsToWatch.length === 0) {
      throw new Error('No targets to watch');
    }

    this.logger.info(`👻 [Poltergeist] Building ${targetsToWatch.length} enabled target(s)`);

    // Initialize target states
    for (const target of targetsToWatch) {
      const builder = this.builderFactory.createBuilder(target, this.projectRoot, this.logger, this.stateManager);
      await builder.validate();
      
      this.targetStates.set(target.name, {
        target,
        builder,
        watching: false,
        pendingFiles: new Set(),
      });

      // Initialize state file
      await this.stateManager.initializeState(target);
    }

    // Connect to Watchman
    if (!this.watchman) {
      this.watchman = new WatchmanClient(this.logger);
    }
    await this.watchman.connect();
    
    // Watch the project
    await this.watchman.watchProject(this.projectRoot);

    // Subscribe to file changes for each target
    await this.subscribeToChanges();

    // Do initial builds
    await this.performInitialBuilds();

    this.logger.info('👻 [Poltergeist] is now watching for changes...');

    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
    process.on('exit', () => this.cleanup());
  }

  private getTargetsToWatch(targetName?: string): Target[] {
    if (targetName) {
      const target = this.config.targets.find(t => t.name === targetName);
      if (!target) {
        throw new Error(`Target '${targetName}' not found`);
      }
      if (!target.enabled) {
        throw new Error(`Target '${targetName}' is disabled`);
      }
      return [target];
    }

    // Return all enabled targets
    return this.config.targets.filter(t => t.enabled);
  }

  private async subscribeToChanges(): Promise<void> {
    if (!this.watchman) return;

    // Group targets by their watch paths to optimize subscriptions
    const pathToTargets = new Map<string, Set<string>>();
    
    for (const [name, state] of this.targetStates) {
      for (const pattern of state.target.watchPaths) {
        if (!pathToTargets.has(pattern)) {
          pathToTargets.set(pattern, new Set());
        }
        pathToTargets.get(pattern)!.add(name);
      }
    }

    // Create subscriptions
    for (const [pattern, targetNames] of pathToTargets) {
      const subscriptionName = `poltergeist_${pattern.replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      await this.watchman.subscribe(
        this.projectRoot,
        subscriptionName,
        {
          expression: ['match', pattern, 'wholename'],
          fields: ['name', 'exists', 'type'],
        },
        (files) => {
          this.handleFileChanges(files, Array.from(targetNames));
        }
      );

      this.logger.info(`👻 Watching ${targetNames.size} target(s): ${pattern}`);
    }
  }

  private handleFileChanges(files: any[], targetNames: string[]): void {
    const changedFiles = files
      .filter(f => f.exists && f.type === 'f')
      .map(f => f.name);

    if (changedFiles.length === 0) return;

    this.logger.debug(`Files changed: ${changedFiles.join(', ')}`);

    // Add changed files to pending for each affected target
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
      const delay = state.target.settlingDelay || 
                   this.config.watchman?.settlingDelay || 
                   1000;

      state.buildTimer = setTimeout(() => {
        this.buildTarget(targetName);
      }, delay);
    }
  }

  private async performInitialBuilds(): Promise<void> {
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
      const status = await state.builder.build(changedFiles);
      state.lastBuild = status;

      // Send notification
      if (this.notifier) {
        if (status.status === 'success') {
          const duration = status.duration ? `${(status.duration / 1000).toFixed(1)}s` : '';
          const outputInfo = state.builder.getOutputInfo();
          const message = outputInfo 
            ? `Built: ${outputInfo}${duration ? ` in ${duration}` : ''}`
            : `Build completed${duration ? ` in ${duration}` : ''}`;
            
          await this.notifier.notifyBuildComplete(
            `${targetName} Built`,
            message,
            state.target.icon
          );
        } else if (status.status === 'failure') {
          await this.notifier.notifyBuildFailed(
            `${targetName} Failed`,
            status.errorSummary || status.error || 'Build failed',
            state.target.icon
          );
        }
      }
    } catch (error: any) {
      this.logger.error(`[${targetName}] Build error: ${error.message}`);
      
      if (this.notifier) {
        await this.notifier.notifyBuildFailed(
          `${targetName} Error`,
          error.message,
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
        state.builder.stop();
        this.targetStates.delete(targetName);
        await this.stateManager.removeState(targetName);
      }
    } else {
      // Stop all targets
      for (const state of this.targetStates.values()) {
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
  }

  public async getStatus(targetName?: string): Promise<Record<string, any>> {
    const status: Record<string, any> = {};

    if (targetName) {
      const state = this.targetStates.get(targetName);
      const stateFile = await this.stateManager.readState(targetName);
      
      if (state && stateFile) {
        status[targetName] = {
          status: state.watching ? 'watching' : 'idle',
          process: stateFile.process,
          lastBuild: stateFile.lastBuild || state.lastBuild,
          appInfo: stateFile.appInfo,
          pendingFiles: state.pendingFiles.size,
        };
      } else if (stateFile) {
        status[targetName] = {
          status: stateFile.process.isActive ? 'running' : 'stopped',
          process: stateFile.process,
          lastBuild: stateFile.lastBuild,
          appInfo: stateFile.appInfo,
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
          };
        } else if (stateFile) {
          status[target.name] = {
            status: stateFile.process.isActive ? 'running' : 'stopped',
            enabled: target.enabled,
            type: target.type,
            process: stateFile.process,
            lastBuild: stateFile.lastBuild,
            appInfo: stateFile.appInfo,
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

    return status;
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