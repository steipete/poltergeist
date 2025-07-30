import { EventEmitter } from 'events';
import { readFile, writeFile, unlink, mkdir, rename } from 'fs/promises';
import { open } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { Logger } from 'winston';
import { createHash } from 'crypto';
import { WatchmanClient } from './watchman.js';
import { CLIBuilder, MacAppBuilder, Builder } from './builder.js';
import { BuildNotifier } from './notifier.js';
import type { 
  PoltergeistConfig, 
  BuildTarget, 
  FileChange,
  BuildStatus
} from './types.js';

export class Poltergeist extends EventEmitter {
  private watchman: WatchmanClient;
  private builders: Map<BuildTarget, Builder> = new Map();
  private buildQueues: Map<BuildTarget, FileChange[]> = new Map();
  private isBuilding: Map<BuildTarget, boolean> = new Map();
  private notifier: BuildNotifier;
  private projectName: string;
  private lastNotificationTime: Map<BuildTarget, number> = new Map();
  private lastBuildTime: Map<BuildTarget, number> = new Map();
  private lockFilePath?: string;
  private stateFilePaths: Map<BuildTarget, string> = new Map();
  private projectHash: string;

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
    
    // Generate project hash for unique identification
    this.projectHash = createHash('sha256')
      .update(this.projectRoot)
      .digest('hex')
      .substring(0, 8);

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

  private async acquireLock(): Promise<void> {
    const lockFileName = `${this.projectName}-${this.projectHash}.lock`;
    this.lockFilePath = path.join('/tmp/poltergeist', lockFileName);
    
    try {
      // Try to create lock file exclusively
      const fd = await open(this.lockFilePath, 'wx');
      
      // Write PID and project path
      const lockContent = `${process.pid}\n${this.projectRoot}\n`;
      await fd.write(lockContent);
      await fd.close();
      
      this.logger.debug(`Lock acquired: ${this.lockFilePath}`);
      
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock file exists, check if process is still running
        try {
          const content = await readFile(this.lockFilePath, 'utf8');
          const lines = content.trim().split('\n');
          const pid = parseInt(lines[0]);
          const projectPath = lines[1];
          
          // Check if process is alive
          try {
            process.kill(pid, 0); // Signal 0 = check only
            
            this.logger.warn(`Poltergeist is already running for this project:`);
            this.logger.warn(`  PID: ${pid}`);
            this.logger.warn(`  Project: ${projectPath}`);
            this.logger.warn(`  Lock file: ${this.lockFilePath}`);
            
            console.log(`\nPoltergeist is already running for this project (PID: ${pid})`);
            console.log('If this is incorrect, the process may have crashed.');
            console.log(`You can remove the lock file manually: rm ${this.lockFilePath}\n`);
            
            process.exit(0);
          } catch {
            // Process is dead, remove stale lock
            this.logger.info('Found stale lock file, removing...');
            await unlink(this.lockFilePath);
            // Retry
            return this.acquireLock();
          }
        } catch (readErr) {
          // Can't read lock file, remove it and retry
          this.logger.warn('Corrupted lock file, removing...');
          await unlink(this.lockFilePath);
          return this.acquireLock();
        }
      } else {
        throw err;
      }
    }
  }

  private setupSignalHandlers(): void {
    const cleanup = async () => {
      // Clean up lock file
      if (this.lockFilePath) {
        try {
          await unlink(this.lockFilePath);
          this.logger.debug('Lock file removed');
        } catch {
          // Already removed or doesn't exist
        }
      }
      
      // Mark all state files as inactive
      for (const [, statePath] of this.stateFilePaths) {
        try {
          const state = await this.readStateFile(statePath);
          if (state) {
            state.process.isActive = false;
            await this.writeStateFile(statePath, state);
          }
        } catch {
          // State file doesn't exist or can't be updated
        }
      }
    };
    
    // Handle various termination signals
    process.on('SIGINT', async () => {
      this.logger.info('Received SIGINT, cleaning up...');
      await cleanup();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      this.logger.info('Received SIGTERM, cleaning up...');
      await cleanup();
      process.exit(0);
    });
    
    process.on('exit', () => {
      // Synchronous cleanup for exit event
      if (this.lockFilePath && existsSync(this.lockFilePath)) {
        try {
          require('fs').unlinkSync(this.lockFilePath);
        } catch {
          // Best effort
        }
      }
    });
  }

  async start(): Promise<void> {
    this.logger.info('Starting Poltergeist...');
    this.logger.debug(`Project root: ${this.projectRoot}`);
    this.logger.debug(`Mode: ${this.mode}`);
    this.logger.debug(`Active builders: ${Array.from(this.builders.keys()).join(', ')}`);

    // Ensure /tmp/poltergeist directory exists
    const lockDir = '/tmp/poltergeist';
    try {
      await mkdir(lockDir, { recursive: true });
    } catch (err) {
      // Directory might already exist, that's fine
    }

    // Try to acquire lock
    await this.acquireLock();

    // Set up state file paths
    for (const target of this.builders.keys()) {
      const stateFileName = `${this.projectName}-${this.projectHash}-${target}.state`;
      this.stateFilePaths.set(target, path.join(lockDir, stateFileName));
    }

    // Set up signal handlers for cleanup
    this.setupSignalHandlers();

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

    // Initialize state files for all targets
    for (const target of this.builders.keys()) {
      await this.updateStateFile(target);
    }

    // Start heartbeat
    this.startHeartbeat();

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

    // Get target config
    const targetConfig = target === 'cli' ? this.config.cli : this.config.macApp;
    if (!targetConfig) return;

    // Check debounce interval
    const now = Date.now();
    const lastBuild = this.lastBuildTime.get(target) || 0;
    const timeSinceLastBuild = now - lastBuild;
    
    if (timeSinceLastBuild < targetConfig.debounceInterval) {
      // Too soon to build, reschedule
      const delay = targetConfig.debounceInterval - timeSinceLastBuild;
      this.logger.debug(`[${target}] Debouncing build, waiting ${delay}ms`);
      
      setTimeout(() => {
        // Re-queue processing if there are still changes
        if (this.buildQueues.get(target)?.length && !this.isBuilding.get(target)) {
          this.processBuildQueue(target);
        }
      }, delay);
      
      return;
    }

    // Mark as building
    this.isBuilding.set(target, true);
    this.lastBuildTime.set(target, now);

    // Clear the queue
    this.buildQueues.set(target, []);

    try {
      // Use already retrieved target config
      const targetName = targetConfig.name;

      // Check if we should send build start notification (debounced)
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

      // Update state file with build results
      await this.updateStateFile(target);

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
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.notifier.notifyBuildFailed(target, this.projectName, errorMessage, targetConfig.name);
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

  private async readStateFile(statePath: string): Promise<any> {
    try {
      const content = await readFile(statePath, 'utf8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async writeStateFile(statePath: string, state: any): Promise<void> {
    const tempPath = `${statePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2));
    // Atomic rename
    await rename(tempPath, statePath);
  }

  private async updateStateFile(target: BuildTarget): Promise<void> {
    const statePath = this.stateFilePaths.get(target);
    if (!statePath) return;

    const config = target === 'cli' ? this.config.cli : this.config.macApp;
    if (!config) return;

    // Read current build status from builder's status file
    let buildStatus: BuildStatus | null = null;
    try {
      const statusContent = await readFile(config.statusFile, 'utf8');
      buildStatus = JSON.parse(statusContent);
    } catch {
      // Status file doesn't exist yet
    }

    const state = {
      version: "1.0",
      projectPath: this.projectRoot,
      projectName: this.projectName,
      target: target,
      configPath: path.join(this.projectRoot, '.poltergeist.json'),
      
      process: {
        pid: process.pid,
        isActive: true,
        startTime: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString()
      },
      
      lastBuild: buildStatus ? {
        status: buildStatus.status,
        timestamp: buildStatus.timestamp,
        gitHash: buildStatus.gitHash,
        errorSummary: buildStatus.errorSummary,
        buildTime: buildStatus.buildTime,
        fullError: buildStatus.errorSummary // We'd need to enhance this to capture full error
      } : null,
      
      appInfo: {
        // These would need to be populated based on the target type
        bundleId: config.bundleId || `com.poltergeist.${this.projectName}`,
        outputPath: config.outputPath || '',
        iconPath: config.iconPath || ''
      }
    };

    await this.writeStateFile(statePath, state);
  }

  // Add heartbeat updating
  private startHeartbeat(): void {
    setInterval(async () => {
      for (const [, statePath] of this.stateFilePaths) {
        try {
          const state = await this.readStateFile(statePath);
          if (state && state.process) {
            state.process.lastHeartbeat = new Date().toISOString();
            await this.writeStateFile(statePath, state);
          }
        } catch {
          // Ignore errors
        }
      }
    }, 10000); // Update every 10 seconds
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