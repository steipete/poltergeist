import type { FSWatcher } from 'fs';
import { watch } from 'fs';

export type WatchFactory = typeof watch;

export interface PanelWatchServiceOptions {
  stateDir: string;
  configPath?: string;
  onStateChange: (event: string, filename?: string | Buffer | null) => void;
  onConfigChange: () => void;
  watchFactory?: WatchFactory;
  logger: { warn: (msg: string) => void };
}

/**
 * Thin wrapper around fs.watch so we can stub or wrap it in tests.
 */
export class PanelWatchService {
  private stateWatcher?: FSWatcher;
  private configWatcher?: FSWatcher;
  private readonly options: PanelWatchServiceOptions;
  private readonly watchFactory: WatchFactory;

  constructor(options: PanelWatchServiceOptions) {
    this.options = options;
    this.watchFactory = options.watchFactory ?? watch;
  }

  start(): void {
    try {
      this.stateWatcher = this.watchFactory(this.options.stateDir, (event, filename) => {
        this.options.onStateChange(event, filename ?? null);
      });
    } catch (error) {
      this.options.logger.warn(`State watcher disabled: ${error}`);
    }

    if (this.options.configPath) {
      try {
        this.configWatcher = this.watchFactory(this.options.configPath, () =>
          this.options.onConfigChange()
        );
      } catch (error) {
        this.options.logger.warn(`Config watcher disabled: ${error}`);
      }
    }
  }

  stop(): void {
    if (this.stateWatcher) {
      this.stateWatcher.close();
      this.stateWatcher = undefined;
    }
    if (this.configWatcher) {
      this.configWatcher.close();
      this.configWatcher = undefined;
    }
  }
}
