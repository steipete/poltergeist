import { EventEmitter } from 'events';
import { existsSync, mkdirSync, watch, type FSWatcher } from 'fs';
import { FileSystemUtils } from '../utils/filesystem.js';
import type { PanelControllerOptions, PanelSnapshot, TargetPanelEntry } from './types.js';
import { GitMetricsCollector } from './git-metrics.js';
import { LogTailReader } from './log-reader.js';
import type { StatusObject } from '../status/types.js';

interface UpdateEvent {
  snapshot: PanelSnapshot;
}

type UpdateListener = (snapshot: PanelSnapshot) => void;

export class StatusPanelController {
  private snapshot: PanelSnapshot;
  private readonly emitter = new EventEmitter();
  private readonly gitCollector: GitMetricsCollector;
  private readonly logReader: LogTailReader;
  private readonly stateDir: string;
  private readonly stateFileMap: Map<string, string>;
  private watcher?: FSWatcher;
  private statusInterval?: NodeJS.Timeout;
  private gitInterval?: NodeJS.Timeout;
  private refreshing?: Promise<void>;
  private disposed = false;
  private readonly gitPollMs: number;
  private readonly statusPollMs: number;

  constructor(private readonly options: PanelControllerOptions) {
    this.stateDir = FileSystemUtils.getStateDirectory();
    this.stateFileMap = new Map(
      options.config.targets.map((target) => [
        FileSystemUtils.generateStateFileName(options.projectRoot, target.name),
        target.name,
      ])
    );
    this.gitCollector = new GitMetricsCollector({ throttleMs: options.gitPollIntervalMs ?? 5000 });
    this.logReader = new LogTailReader(options.projectRoot);
    this.gitPollMs = options.gitPollIntervalMs ?? 5000;
    this.statusPollMs = options.statusPollIntervalMs ?? 2000;

    this.snapshot = {
      targets: options.config.targets.map((target) => ({
        name: target.name,
        status: { status: 'unknown' },
        targetType: target.type,
        enabled: target.enabled,
      })),
      summary: {
        totalTargets: options.config.targets.length,
        building: 0,
        failures: 0,
        running: 0,
      },
      git: this.gitCollector.getCached(options.projectRoot) ?? {
        dirtyFiles: 0,
        insertions: 0,
        deletions: 0,
        branch: undefined,
        hasRepo: true,
        lastUpdated: Date.now(),
      },
      projectName: options.projectRoot.split(/[\\/]/).pop() || options.projectRoot,
      projectRoot: options.projectRoot,
      preferredIndex: 0,
      lastUpdated: Date.now(),
    };
  }

  public getSnapshot(): PanelSnapshot {
    return this.snapshot;
  }

  public async start(): Promise<void> {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }

    await this.refreshStatus({ refreshGit: true, forceGit: true });
    this.setupWatchers();
    this.statusInterval = setInterval(() => {
      void this.refreshStatus();
    }, this.statusPollMs);
    this.gitInterval = setInterval(() => {
      void this.refreshGit();
    }, this.gitPollMs);
  }

  public onUpdate(listener: UpdateListener): () => void {
    const wrapped = ({ snapshot }: UpdateEvent) => listener(snapshot);
    this.emitter.on('update', wrapped);
    return () => {
      this.emitter.off('update', wrapped);
    };
  }

  public async forceRefresh(): Promise<void> {
    await this.refreshStatus({ refreshGit: true, forceGit: true });
  }

  public async getLogLines(targetName: string): Promise<string[]> {
    return this.logReader.read(targetName);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = undefined;
    }
    if (this.gitInterval) {
      clearInterval(this.gitInterval);
      this.gitInterval = undefined;
    }
    this.emitter.removeAllListeners();
  }

  private setupWatchers(): void {
    try {
      this.watcher = watch(this.stateDir, (eventType, filename) => {
        if (!filename) {
          void this.refreshStatus({ refreshGit: true, forceGit: true });
          return;
        }
        const key = filename.toString();
        if (this.stateFileMap.has(key)) {
          void this.refreshStatus({ refreshGit: true, forceGit: true });
        } else if (eventType === 'rename') {
          // Capture newly created files in case targets were added.
          void this.refreshStatus();
        }
      });
    } catch (error) {
      this.options.logger.warn(`State watcher disabled: ${error}`);
    }
  }

  private computeSummary(targets: TargetPanelEntry[]): PanelSnapshot['summary'] {
    return targets.reduce<PanelSnapshot['summary']>(
      (acc, entry) => {
        acc.totalTargets += 1;
        if (entry.status.lastBuild?.status === 'building') {
          acc.building += 1;
        } else if (entry.status.lastBuild?.status === 'failure') {
          acc.failures += 1;
        }
        if (entry.status.process?.isActive) {
          acc.running += 1;
        }
        return acc;
      },
      { totalTargets: 0, building: 0, failures: 0, running: 0 }
    );
  }

  private computePreferredIndex(targets: TargetPanelEntry[]): number {
    if (targets.length === 0) {
      return 0;
    }
    const buildingIndex = targets.findIndex(
      (entry) => entry.status.lastBuild?.status === 'building'
    );
    if (buildingIndex !== -1) {
      return buildingIndex;
    }
    const failedIndex = targets.findIndex((entry) => entry.status.lastBuild?.status === 'failure');
    if (failedIndex !== -1) {
      return failedIndex;
    }
    return 0;
  }

  private async refreshStatus(options?: { refreshGit?: boolean; forceGit?: boolean }): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.refreshing) {
      return this.refreshing;
    }

    this.refreshing = (async () => {
      const statusMap = await this.options.fetchStatus();
      const targets = this.options.config.targets.map((target) => ({
        name: target.name,
        status: (statusMap[target.name] as StatusObject) || { status: 'unknown' },
        targetType: target.type,
        enabled: target.enabled,
      }));

      const summary = this.computeSummary(targets);
      let git = this.snapshot.git;
      if (options?.refreshGit) {
        git = await this.gitCollector.refresh(this.options.projectRoot, options.forceGit);
      }

      this.snapshot = {
        targets,
        summary,
        git,
        projectName: this.snapshot.projectName,
        projectRoot: this.snapshot.projectRoot,
        preferredIndex: this.computePreferredIndex(targets),
        lastUpdated: Date.now(),
      };

      this.emitter.emit('update', { snapshot: this.snapshot });
    })().finally(() => {
      this.refreshing = undefined;
    });

    await this.refreshing;
  }

  private async refreshGit(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const git = await this.gitCollector.refresh(this.options.projectRoot);
    this.snapshot = {
      ...this.snapshot,
      git,
      lastUpdated: Date.now(),
    };
    this.emitter.emit('update', { snapshot: this.snapshot });
  }
}
