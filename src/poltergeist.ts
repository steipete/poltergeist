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

  constructor(
    private config: PoltergeistConfig,
    private projectRoot: string,
    private logger: Logger,
    private mode: 'cli' | 'mac' | 'all' = 'all'
  ) {
    super();
    
    this.watchman = new WatchmanClient(logger);
    this.projectName = path.basename(projectRoot);
    this.notifier = new BuildNotifier(
      this.config.notifications.enabled,
      this.config.notifications.successSound,
      this.config.notifications.failureSound
    );

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
    if ((this.mode === 'cli' || this.mode === 'all') && this.config.cli?.enabled) {
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
      this.builders.set('macApp', new MacAppBuilder(
        'macApp',
        this.config.macApp,
        this.projectRoot,
        this.logger
      ));
      this.buildQueues.set('macApp', []);
      this.isBuilding.set('macApp', false);
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting Poltergeist...');

    // Connect to watchman
    await this.watchman.connect();
    
    // Watch the project
    await this.watchman.watchProject(this.projectRoot);

    // Set up subscriptions for each target
    for (const [target] of this.builders) {
      const config = target === 'cli' ? this.config.cli : this.config.macApp;
      if (config) {
        await this.watchman.subscribe(
          target,
          config.watchPaths,
          config.settlingDelay
        );
        this.logger.info(`Watching ${target}: ${config.watchPaths.join(', ')}`);
      }
    }

    // Notify that we've started
    const targets = Array.from(this.builders.keys()).map(t => 
      t === 'cli' ? 'CLI' : 'Mac App'
    );
    await this.notifier.notifyPoltergeistStarted(targets);

    this.logger.info('Poltergeist is now haunting your Swift files! 👻');
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
      // Run the build
      const result = await builder.build();

      // Send notification
      await this.notifier.notifyBuildComplete(target, result, this.projectName);

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
  const config = JSON.parse(configContent);

  // Validate with Zod
  const { PoltergeistConfigSchema } = await import('./types.js');
  return PoltergeistConfigSchema.parse(config);
}