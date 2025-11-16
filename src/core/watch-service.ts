import type { IWatchmanClient, IWatchmanConfigManager } from '../interfaces.js';
import type { Logger } from '../logger.js';
import type { PoltergeistConfig } from '../types.js';
import type { TargetState } from './target-state.js';

interface WatchServiceDeps {
  projectRoot: string;
  config: PoltergeistConfig;
  logger: Logger;
  watchman?: IWatchmanClient;
  watchmanConfigManager: IWatchmanConfigManager;
  onFilesChanged: (
    files: Array<{ name: string; exists: boolean; type?: string }>,
    targetNames: string[]
  ) => void;
}

/**
 * Encapsulates Watchman subscriptions and config-file watching.
 */
export class WatchService {
  private readonly projectRoot: string;
  private readonly config: PoltergeistConfig;
  private readonly logger: Logger;
  private watchman?: IWatchmanClient;
  private readonly watchmanConfigManager: IWatchmanConfigManager;
  private readonly onFilesChanged: (
    files: Array<{ name: string; exists: boolean; type?: string }>,
    targetNames: string[]
  ) => void;
  private readonly subscriptions = new Set<string>();

  constructor({
    projectRoot,
    config,
    logger,
    watchman,
    watchmanConfigManager,
    onFilesChanged,
  }: WatchServiceDeps) {
    this.projectRoot = projectRoot;
    this.config = config;
    this.logger = logger;
    this.watchman = watchman;
    this.watchmanConfigManager = watchmanConfigManager;
    this.onFilesChanged = onFilesChanged;
  }

  public async subscribeTargets(targetStates: Map<string, TargetState>): Promise<void> {
    if (!this.watchman) return;

    const pathToTargets = new Map<string, Set<string>>();
    for (const [name, state] of targetStates) {
      for (const pattern of state.target.watchPaths) {
        if (!pathToTargets.has(pattern)) {
          pathToTargets.set(pattern, new Set());
        }
        pathToTargets.get(pattern)?.add(name);
      }
    }

    for (const [pattern, targetNames] of pathToTargets) {
      try {
        const normalizedPattern = this.watchmanConfigManager.normalizeWatchPattern(pattern);
        this.watchmanConfigManager.validateWatchPattern(normalizedPattern);

        const subscriptionName = `poltergeist_${normalizedPattern.replace(/[^a-zA-Z0-9]/g, '_')}`;
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
            this.onFilesChanged(files, Array.from(targetNames));
          },
          exclusionExpressions
        );
        this.subscriptions.add(subscriptionName);
        targetNames.forEach((targetName) => {
          const state = targetStates.get(targetName);
          if (state) state.watching = true;
        });
        this.logger.info(`👻 Watching ${targetNames.size} target(s): ${normalizedPattern}`);
      } catch (error) {
        this.logger.error(`❌ Invalid watch pattern "${pattern}": ${error}`);
        throw error;
      }
    }
  }

  public async subscribeConfig(
    configPath: string | undefined,
    onChange: (files: Array<{ name: string; exists: boolean }>) => void
  ): Promise<void> {
    if (!this.watchman || !configPath) return;

    try {
      await this.watchman.subscribe(
        this.projectRoot,
        'poltergeist_config',
        {
          expression: ['match', 'poltergeist.config.json', 'wholename'],
          fields: ['name', 'exists', 'type'],
        },
        (files) => onChange(files)
      );
      this.subscriptions.add('poltergeist_config');
      this.logger.info('🔧 Watching configuration file for changes');
    } catch (error) {
      this.logger.warn(`⚠️ Failed to watch config file: ${error}`);
    }
  }

  public async stop(): Promise<void> {
    if (!this.watchman) return;

    for (const name of this.subscriptions) {
      try {
        await this.watchman.unsubscribe(name);
      } catch (error) {
        this.logger.warn(`Failed to unsubscribe ${name}: ${error}`);
      }
    }
    this.subscriptions.clear();

    await this.watchman.disconnect();
    this.watchman = undefined;
  }
}
