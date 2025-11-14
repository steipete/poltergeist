import { EventEmitter } from 'events';
import { existsSync, mkdirSync, watch, type FSWatcher } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { FileSystemUtils } from '../utils/filesystem.js';
import type {
  PanelControllerOptions,
  PanelSnapshot,
  PanelStatusScriptResult,
  TargetPanelEntry,
} from './types.js';
import { GitMetricsCollector } from './git-metrics.js';
import { LogTailReader } from './log-reader.js';
import type { StatusObject } from '../status/types.js';
import type { StatusScriptConfig } from '../types.js';

const execAsync = promisify(exec);

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
  private scriptRefreshing?: Promise<void>;
  private disposed = false;
  private readonly gitPollMs: number;
  private readonly statusPollMs: number;
  private scriptCache: Map<string, CachedStatusScript>;

  constructor(private readonly options: PanelControllerOptions) {
    this.stateDir = FileSystemUtils.getStateDirectory();
    this.stateFileMap = new Map(
      options.config.targets.map((target) => [
        FileSystemUtils.generateStateFileName(options.projectRoot, target.name),
        target.name,
      ])
    );
    this.gitCollector = new GitMetricsCollector({ throttleMs: options.gitPollIntervalMs ?? 5000 });
    this.logReader = new LogTailReader(options.projectRoot, { maxLines: 200 });
    this.gitPollMs = options.gitPollIntervalMs ?? 5000;
    this.statusPollMs = options.statusPollIntervalMs ?? 2000;
    this.scriptCache = new Map();
    if (options.config.statusScripts?.length) {
      this.options.logger.info(
        `[Panel] Loaded ${options.config.statusScripts.length} status script(s)`
      );
    } else {
      this.options.logger.info('[Panel] No status scripts configured');
    }

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
      git:
        this.gitCollector.getCached(options.projectRoot) ?? {
          dirtyFiles: 0,
          dirtyFileNames: [],
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
      statusScripts: [],
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
    await this.refreshStatusScripts(true);
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
    await this.refreshStatusScripts(true);
  }

  public async getLogLines(targetName: string, limit?: number): Promise<string[]> {
    return this.logReader.read(targetName, limit);
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
        statusScripts: this.snapshot.statusScripts,
      };

      this.emitter.emit('update', { snapshot: this.snapshot });
      void this.refreshStatusScripts();
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

  private async refreshStatusScripts(force?: boolean): Promise<void> {
    if (this.disposed || !(this.options.config.statusScripts?.length)) {
      return;
    }

    if (this.scriptRefreshing) {
      return this.scriptRefreshing;
    }

    this.scriptRefreshing = (async () => {
      const configs = this.options.config.statusScripts ?? [];
      const results: PanelStatusScriptResult[] = [];
      const now = Date.now();

      for (const scriptConfig of configs) {
        const cacheKey = this.getScriptCacheKey(scriptConfig);
        const cache = this.scriptCache.get(cacheKey);
        const cooldownMs = (scriptConfig.cooldownSeconds ?? 60) * 1000;

        if (!force && cache && now - cache.lastRun < cooldownMs) {
          results.push(cache.result);
          continue;
        }

        const result = await this.runStatusScript(scriptConfig);
        this.scriptCache.set(cacheKey, { lastRun: result.lastRun, result });
        results.push(result);
      }

      this.snapshot = {
        ...this.snapshot,
        statusScripts: results,
        lastUpdated: Date.now(),
      };
      this.emitter.emit('update', { snapshot: this.snapshot });
    })().finally(() => {
      this.scriptRefreshing = undefined;
    });

    await this.scriptRefreshing;
  }

  private getScriptCacheKey(script: StatusScriptConfig): string {
    const targetsKey = script.targets?.slice().sort().join(',') ?? '';
    return `${script.label}::${script.command}::${targetsKey}`;
  }

  private async runStatusScript(script: StatusScriptConfig): Promise<PanelStatusScriptResult> {
    const now = Date.now();
    const maxLines = script.maxLines ?? 1;

    const options = {
      cwd: this.options.projectRoot,
      timeout: (script.timeoutSeconds ?? 30) * 1000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' },
    } as const;

    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(script.command, options);
      const durationMs = Date.now() - start;
      const lines = this.extractLines(stdout, stderr, maxLines);
      return {
        label: script.label,
        lines,
        targets: script.targets,
        lastRun: now,
        exitCode: 0,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      const output = this.extractLines(execError.stdout, execError.stderr, maxLines);
      if (output.length === 0) {
        output.push(`Error: ${execError.message}`);
      }
      return {
        label: script.label,
        lines: output,
        targets: script.targets,
        lastRun: now,
        exitCode:
          typeof execError.code === 'number'
            ? execError.code
            : typeof execError.code === 'string'
              ? Number.parseInt(execError.code, 10)
              : null,
        durationMs,
      };
    }
  }

  private extractLines(
    stdout?: string,
    stderr?: string,
    maxLines: number = 1
  ): string[] {
    const combined = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
    if (!combined) {
      return [];
    }
    return combined
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, maxLines);
  }
}

interface CachedStatusScript {
  lastRun: number;
  result: PanelStatusScriptResult;
}
