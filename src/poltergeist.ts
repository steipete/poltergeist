import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { Logger } from 'winston';
import { WatchmanClient } from './watchman.js';
import { CLIBuilder, MacAppBuilder, Builder } from './builder.js';
import { BuildNotifier } from './notifier.js';
import type { 
  PoltergeistConfig, 
  BuildTarget, 
  FileChange
} from './types.js';

export class Poltergeist extends EventEmitter {
  private watchman: WatchmanClient;
  private builders: Map<BuildTarget, Builder> = new Map();
  private buildQueues: Map<BuildTarget, FileChange[]> = new Map();
  private isBuilding: Map<BuildTarget, boolean> = new Map();
  private notifier: BuildNotifier;
  private projectName: string;
  private lastNotificationTime: Map<BuildTarget, number> = new Map();

  constructor(
    private config: PoltergeistConfig,
    private projectRoot: string,
    private logger: Logger,
    private mode: 'cli' | 'mac' | 'all' = 'all'
  ) {
    super();
    
    this.watchman = new WatchmanClient(logger);
    this.projectName = path.basename(projectRoot);
    this.notifier = new BuildNotifier(this.config.notifications);

    // Set up builders based on mode
    this.setupBuilders();

    // Handle watchman events
    this.watchman.on('changes', (target: BuildTarget, changes: FileChange[]) => {
      this.handleFileChanges(target, changes);
    });

    this.watchman.on('error', (error) => {
      this.logger.error('Watchman error:', error);
      this.emit('error', error);
    });
  }

  private setupBuilders(): void {
    this.logger.debug(`Setting up builders for mode: ${this.mode}`);
    this.logger.debug(`Config has cli: ${!!this.config.cli}, enabled: ${this.config.cli?.enabled}`);
    this.logger.debug(`Config has macApp: ${!!this.config.macApp}, enabled: ${this.config.macApp?.enabled}`);
    
    if ((this.mode === 'cli' || this.mode === 'all') && this.config.cli?.enabled) {
      this.logger.debug('Creating CLI builder');
      this.builders.set('cli', new CLIBuilder(
        'cli',
        this.config.cli,
        this.projectRoot,
        this.logger
      ));
      this.buildQueues.set('cli', []);
      this.isBuilding.set('cli', false);
    }

    if ((this.mode === 'mac' || this.mode === 'all') && this.config.macApp?.enabled) {
      this.logger.debug('Creating Mac App builder');
      this.builders.set('macApp', new MacAppBuilder(
        'macApp',
        this.config.macApp,
        this.projectRoot,
        this.logger
      ));
      this.buildQueues.set('macApp', []);
      this.isBuilding.set('macApp', false);
    }
    
    this.logger.debug(`Builders created: ${Array.from(this.builders.keys()).join(', ')}`);
  }

  async start(): Promise<void> {
    this.logger.info('Starting Poltergeist...');
    this.logger.debug(`Project root: ${this.projectRoot}`);
    this.logger.debug(`Mode: ${this.mode}`);
    this.logger.debug(`Active builders: ${Array.from(this.builders.keys()).join(', ')}`);

    // Connect to watchman
    await this.watchman.connect();
    
    // Watch the project
    await this.watchman.watchProject(this.projectRoot);

    // Set up subscriptions for each target
    for (const [target] of this.builders) {
      const config = target === 'cli' ? this.config.cli : this.config.macApp;
      if (config) {
        this.logger.debug(`Setting up subscription for ${target}`);
        await this.watchman.subscribe(
          target,
          config.watchPaths,
          config.settlingDelay
        );
        this.logger.info(`Watching ${target}: ${config.watchPaths.join(', ')}`);
      } else {
        this.logger.warn(`No config found for target: ${target}`);
      }
    }

    // Notify that we've started
    const targets = Array.from(this.builders.keys()).map(t => 
      t === 'cli' ? 'CLI' : 'Mac App'
    );
    await this.notifier.notifyPoltergeistStarted(targets);

    this.logger.info('Poltergeist is now haunting your project files! 👻');
  }

  async stop(): Promise<void> {
    this.logger.info('Stopping Poltergeist...');

    // Cancel any ongoing builds
    for (const builder of this.builders.values()) {
      await builder.cancelBuild();
    }

    // Shutdown watchman
    await this.watchman.shutdown();

    // Notify that we've stopped
    await this.notifier.notifyPoltergeistStopped();

    this.logger.info('Poltergeist is now at rest 💤');
  }

  private async handleFileChanges(target: BuildTarget, changes: FileChange[]): Promise<void> {
    // Add changes to the queue
    const queue = this.buildQueues.get(target) || [];
    queue.push(...changes);
    this.buildQueues.set(target, queue);

    // Log the changes
    const changedFiles = changes.map(c => path.relative(this.projectRoot, c.path));
    this.logger.info(`[${target}] Files changed: ${changedFiles.join(', ')}`);

    // Start build if not already building
    if (!this.isBuilding.get(target)) {
      await this.processBuildQueue(target);
    }
  }

  private async processBuildQueue(target: BuildTarget): Promise<void> {
    const queue = this.buildQueues.get(target);
    const builder = this.builders.get(target);

    if (!queue || queue.length === 0 || !builder) {
      return;
    }

    // Mark as building
    this.isBuilding.set(target, true);

    // Clear the queue
    this.buildQueues.set(target, []);

    try {
      // Get target config for display name
      const targetConfig = target === 'cli' ? this.config.cli : this.config.macApp;
      const targetName = targetConfig?.name;

      // Check if we should send build start notification (debounced)
      const now = Date.now();
      const lastNotification = this.lastNotificationTime.get(target) || 0;
      const shouldNotify = (now - lastNotification) >= this.config.notifications.minInterval;

      if (shouldNotify) {
        // Send build start notification
        await this.notifier.notifyBuildStart(target, this.projectName, targetName);
        this.lastNotificationTime.set(target, now);
      }

      // Run the build
      const result = await builder.build();

      // Send notification based on result (only if enough time has passed)
      if (shouldNotify) {
        if (!result.success) {
          await this.notifier.notifyBuildFailed(target, this.projectName, result.error || 'Unknown error', targetName);
        } else {
          await this.notifier.notifyBuildComplete(target, result, this.projectName, targetName);
        }
      }

      // Run post-build actions (like auto-relaunch)
      await builder.postBuild(result);

      // Handle retries if build failed
      if (!result.success && await builder.handleRetry()) {
        // Re-add a dummy change to trigger rebuild
        this.buildQueues.get(target)?.push({
          path: 'retry',
          exists: true,
          new: false,
          size: 0,
          mode: 0,
        });
      }

    } catch (error) {
      this.logger.error(`[${target}] Build error:`, error);
      // Also notify on exception
      const targetConfig = target === 'cli' ? this.config.cli : this.config.macApp;
      const targetName = targetConfig?.name;
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.notifier.notifyBuildFailed(target, this.projectName, errorMessage, targetName);
    } finally {
      // Mark as not building
      this.isBuilding.set(target, false);

      // Process any new changes that came in during the build
      if (this.buildQueues.get(target)?.length) {
        await this.processBuildQueue(target);
      }
    }
  }

  async status(): Promise<Map<BuildTarget, any>> {
    const status = new Map();

    for (const [target] of this.builders) {
      const config = target === 'cli' ? this.config.cli : this.config.macApp;
      if (!config) continue;

      try {
        const statusFile = await readFile(config.statusFile, 'utf8');
        const buildStatus = JSON.parse(statusFile);
        status.set(target, {
          ...buildStatus,
          isBuilding: this.isBuilding.get(target),
          queueLength: this.buildQueues.get(target)?.length || 0,
        });
      } catch {
        status.set(target, {
          status: 'unknown',
          isBuilding: this.isBuilding.get(target),
          queueLength: this.buildQueues.get(target)?.length || 0,
        });
      }
    }

    return status;
  }
}

// Helper function to load config
export async function loadConfig(configPath: string): Promise<PoltergeistConfig> {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const configContent = await readFile(configPath, 'utf8');
  const rawConfig = JSON.parse(configContent);

  // Transform targets array format to cli/macApp format if needed
  const config: any = {
    notifications: rawConfig.notifications,
    logging: rawConfig.logging
  };

  if (rawConfig.targets && Array.isArray(rawConfig.targets)) {
    // New format with targets array
    for (const target of rawConfig.targets) {
      if (target.type === 'executable') {
        config.cli = target;
      } else if (target.type === 'app-bundle') {
        config.macApp = target;
      }
    }
  } else {
    // Old format with cli/macApp properties
    if (rawConfig.cli) config.cli = rawConfig.cli;
    if (rawConfig.macApp) config.macApp = rawConfig.macApp;
  }

  // Validate with Zod
  const { PoltergeistConfigSchema } = await import('./types.js');
  return PoltergeistConfigSchema.parse(config);
}