export interface PanelSchedulerCallbacks {
  onStatus: () => void;
  onGit: () => void;
}

export interface PanelSchedulerOptions extends PanelSchedulerCallbacks {
  statusPollMs: number;
  gitPollMs: number;
}

/**
 * Coordinates repeating timers for status and git refreshes.
 * Kept small so it can be unit tested with fake timers.
 */
export class PanelScheduler {
  private statusInterval?: NodeJS.Timeout;
  private gitInterval?: NodeJS.Timeout;
  private readonly options: PanelSchedulerOptions;

  constructor(options: PanelSchedulerOptions) {
    this.options = options;
  }

  start(): void {
    if (!this.statusInterval) {
      this.statusInterval = setInterval(this.options.onStatus, this.options.statusPollMs);
    }
    if (!this.gitInterval) {
      this.gitInterval = setInterval(this.options.onGit, this.options.gitPollMs);
    }
  }

  stop(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = undefined;
    }
    if (this.gitInterval) {
      clearInterval(this.gitInterval);
      this.gitInterval = undefined;
    }
  }
}
