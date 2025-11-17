import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import type { StatusObject } from '../status/types.js';
import type { StatusScriptConfig, SummaryScriptConfig } from '../types.js';
import { ConfigurationManager } from '../utils/config-manager.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import { normalizeLogChannels } from '../utils/log-channels.js';
import { GitMetricsCollector } from './git-metrics.js';
import { LogTailReader } from './log-reader.js';
import { PanelScheduler } from './panel-scheduler.js';
import { PanelWatchService } from './panel-watch-service.js';
import { createScriptEventFileSink } from './script-event-log.js';
import { runStatusScript, runSummaryScript } from './script-runner.js';
import { computePreferredIndex, computeSummary } from './snapshot-helpers.js';
import { diffTargets } from './target-diff.js';
import type {
  PanelControllerOptions,
  PanelSnapshot,
  PanelStatusScriptResult,
  PanelSummaryScriptResult,
  ScriptEvent,
} from './types.js';

interface UpdateEvent {
  snapshot: PanelSnapshot;
}

type UpdateListener = (snapshot: PanelSnapshot) => void;
type LogListener = () => void;
type ScriptEventListener = (event: ScriptEvent) => void;

export class StatusPanelController {
  private snapshot: PanelSnapshot;
  private readonly emitter = new EventEmitter();
  private readonly gitCollector: GitMetricsCollector;
  private readonly logReader: Pick<LogTailReader, 'read'>;
  private readonly stateDir: string;
  private stateFileMap: Map<string, string>;
  private watchService?: PanelWatchService;
  private scheduler?: PanelScheduler;
  private refreshing?: Promise<void>;
  private scriptRefreshing?: Promise<void>;
  private summaryRefreshing?: Promise<void>;
  private pendingStatusScripts = false;
  private pendingSummaryScripts = false;
  private configReloading?: Promise<void>;
  private disposed = false;
  private readonly gitPollMs: number;
  private readonly statusPollMs: number;
  private scriptCache: Map<string, CachedStatusScript>;
  private summaryScriptCache: Map<string, CachedSummaryScript>;
  private readonly gitSummaryMode: 'list' | 'ai';
  private readonly profileEnabled: boolean;

  constructor(private readonly options: PanelControllerOptions) {
    this.stateDir = FileSystemUtils.getStateDirectory();
    this.stateFileMap = new Map(
      options.config.targets.map((target) => [
        FileSystemUtils.generateStateFileName(options.projectRoot, target.name),
        target.name,
      ])
    );
    const envGitMode = (process.env.POLTERGEIST_GIT_MODE ?? '').toLowerCase();
    const defaultGitMode: 'ai' | 'list' = envGitMode === 'list' ? 'list' : 'ai';
    this.gitSummaryMode = options.gitSummaryMode ?? defaultGitMode;
    this.gitCollector = new GitMetricsCollector({
      throttleMs: options.gitPollIntervalMs ?? 5000,
      summaryMode: this.gitSummaryMode,
      logger: options.logger,
    });
    this.logReader =
      options.logReader ??
      new LogTailReader(options.projectRoot, { maxLines: 200, config: options.config });
    this.gitPollMs = options.gitPollIntervalMs ?? 5000;
    this.statusPollMs = options.statusPollIntervalMs ?? 2000;
    this.scriptCache = new Map();
    this.summaryScriptCache = new Map();
    this.profileEnabled = process.env.POLTERGEIST_PANEL_PROFILE === '1';
    const sinks: Array<(e: ScriptEvent) => void> = [];
    if (process.env.POLTERGEIST_SCRIPT_EVENT_LOG === '1') {
      sinks.push(
        createScriptEventFileSink({
          path: process.env.POLTERGEIST_SCRIPT_EVENT_LOG_PATH,
          maxFiles:
            process.env.POLTERGEIST_SCRIPT_EVENT_LOG_FILES !== undefined
              ? Number(process.env.POLTERGEIST_SCRIPT_EVENT_LOG_FILES)
              : undefined,
          maxBytes:
            process.env.POLTERGEIST_SCRIPT_EVENT_LOG_BYTES !== undefined
              ? Number(process.env.POLTERGEIST_SCRIPT_EVENT_LOG_BYTES)
              : undefined,
        })
      );
    }
    if (process.env.POLTERGEIST_SCRIPT_EVENT_STDOUT === '1') {
      sinks.push((event) => {
        try {
          process.stdout.write(`${JSON.stringify(event)}\n`);
        } catch {
          // ignore
        }
      });
    }
    if (this.options.scriptEventSink) {
      sinks.push(this.options.scriptEventSink);
    }
    if (sinks.length > 0) {
      this.options.scriptEventSink = (event) => {
        for (const sink of sinks) {
          sink(event);
        }
      };
    }
    if (options.config.statusScripts?.length) {
      this.options.logger.debug(
        `[Panel] Loaded ${options.config.statusScripts.length} status script(s)`
      );
    } else {
      this.options.logger.debug('[Panel] No status scripts configured');
    }
    if (options.config.summaryScripts?.length) {
      this.options.logger.debug(
        `[Panel] Loaded ${options.config.summaryScripts.length} summary script(s)`
      );
    } else {
      this.options.logger.debug('[Panel] No summary scripts configured');
    }

    this.snapshot = {
      targets: options.config.targets.map((target) => ({
        name: target.name,
        status: { status: 'unknown' },
        targetType: target.type,
        enabled: target.enabled,
        group: target.group,
        // Normalize upfront so downstream UI can safely index into channels without re-validating.
        logChannels: normalizeLogChannels(target.logChannels),
      })),
      summary: {
        totalTargets: options.config.targets.length,
        building: 0,
        failures: 0,
        targetFailures: 0,
        scriptFailures: 0,
        running: 0,
        activeDaemons: [],
      },
      git: this.gitCollector.getCached(options.projectRoot) ?? {
        dirtyFiles: 0,
        dirtyFileNames: [],
        insertions: 0,
        deletions: 0,
        branch: undefined,
        hasRepo: true,
        lastUpdated: Date.now(),
        summaryMode: this.gitSummaryMode,
      },
      projectName: options.projectRoot.split(/[\\/]/).pop() || options.projectRoot,
      projectRoot: options.projectRoot,
      preferredIndex: options.config.targets.length, // default to summary row when available
      lastUpdated: Date.now(),
      paused: FileSystemUtils.readPauseFlag(options.projectRoot),
      statusScripts: [],
      summaryScripts: [],
    };
  }

  // Wrapper for easier spying in tests.
  protected runStatusScript(
    scriptConfig: StatusScriptConfig,
    projectRoot: string
  ): Promise<PanelStatusScriptResult> {
    return runStatusScript(scriptConfig, projectRoot);
  }

  public getSnapshot(): PanelSnapshot {
    return this.snapshot;
  }

  public async start(): Promise<void> {
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }

    await this.refreshStatus({ refreshGit: true, forceGit: true });
    // Kick scripts asynchronously so the panel can render immediately.
    void this.refreshStatusScripts(true);
    void this.refreshSummaryScripts(true);
    this.setupWatchers();
    this.setupScheduler();
  }

  public onUpdate(listener: UpdateListener): () => void {
    const wrapped = ({ snapshot }: UpdateEvent) => listener(snapshot);
    this.emitter.on('update', wrapped);
    return () => {
      this.emitter.off('update', wrapped);
    };
  }

  public onLogUpdate(listener: LogListener): () => void {
    this.emitter.on('log-update', listener);
    return () => {
      this.emitter.off('log-update', listener);
    };
  }

  public onScriptEvent(listener: ScriptEventListener): () => void {
    this.emitter.on('script-event', listener);
    return () => {
      this.emitter.off('script-event', listener);
    };
  }

  public async forceRefresh(): Promise<void> {
    await this.refreshStatus({ refreshGit: true, forceGit: true });
    await this.refreshStatusScripts(true);
  }

  public async pause(): Promise<void> {
    FileSystemUtils.writePauseFlag(this.options.projectRoot, true);
    await this.refreshStatus({ refreshGit: false });
  }

  public async resume(): Promise<void> {
    FileSystemUtils.writePauseFlag(this.options.projectRoot, false);
    await this.refreshStatus({ refreshGit: false });
  }

  public async getLogLines(
    targetName: string,
    channel?: string,
    limit?: number
  ): Promise<string[]> {
    return this.logReader.read(targetName, channel, limit);
  }

  public dispose(): void {
    this.disposed = true;
    this.watchService?.stop();
    this.scheduler?.stop();
    this.emitter.removeAllListeners();
  }

  private setupWatchers(): void {
    this.watchService = new PanelWatchService({
      stateDir: this.stateDir,
      configPath: this.options.configPath,
      logger: this.options.logger,
      onStateChange: (eventType, filename) => {
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
      },
      onConfigChange: () => {
        void this.reloadConfig();
      },
    });
    this.watchService.start();
  }

  private setupScheduler(): void {
    this.scheduler = new PanelScheduler({
      statusPollMs: this.statusPollMs,
      gitPollMs: this.gitPollMs,
      onStatus: () => {
        void this.refreshStatus();
      },
      onGit: () => {
        void this.refreshGit();
      },
    });
    this.scheduler.start();
  }

  private async reloadConfig(): Promise<void> {
    if (this.disposed || !this.options.configPath) {
      return;
    }

    if (this.configReloading) {
      return this.configReloading;
    }

    const { configPath } = this.options;
    this.configReloading = (async () => {
      try {
        const nextConfig = await ConfigurationManager.loadConfigFromPath(configPath);
        this.options.config = nextConfig;
        this.stateFileMap = new Map(
          nextConfig.targets.map((target) => [
            FileSystemUtils.generateStateFileName(this.options.projectRoot, target.name),
            target.name,
          ])
        );
        const nextStatusKeys = new Set(
          (nextConfig.statusScripts ?? []).map((script) => this.getScriptCacheKey(script))
        );
        for (const key of Array.from(this.scriptCache.keys())) {
          if (!nextStatusKeys.has(key)) {
            this.scriptCache.delete(key);
          }
        }
        const nextSummaryKeys = new Set(
          (nextConfig.summaryScripts ?? []).map((script) => this.getSummaryCacheKey(script))
        );
        for (const key of Array.from(this.summaryScriptCache.keys())) {
          if (!nextSummaryKeys.has(key)) {
            this.summaryScriptCache.delete(key);
          }
        }

        const currentByName = new Map(this.snapshot.targets.map((t) => [t.name, t]));
        const targets = nextConfig.targets.map((target) => {
          const existing = currentByName.get(target.name);
          return {
            name: target.name,
            status: existing?.status ?? { status: 'unknown' },
            targetType: target.type,
            enabled: target.enabled,
            group: target.group,
            logChannels: normalizeLogChannels(target.logChannels),
          };
        });

        const targetDiff = diffTargets(this.snapshot.targets, nextConfig.targets);
        if (targetDiff.added.length || targetDiff.removed.length) {
          const added = targetDiff.added.length ? `added: ${targetDiff.added.join(', ')}` : '';
          const removed = targetDiff.removed.length
            ? `removed: ${targetDiff.removed.join(', ')}`
            : '';
          const parts = [added, removed].filter(Boolean).join(' | ');
          this.options.logger.info(`[Panel] Config target diff ${parts}`);
        }

        const previousScriptFailures = this.snapshot.summary.scriptFailures ?? 0;

        this.snapshot = {
          ...this.snapshot,
          targets,
          summary: computeSummary(targets, { scriptFailures: previousScriptFailures }),
          preferredIndex: computePreferredIndex(targets),
          statusScripts: [],
          summaryScripts: [],
          lastUpdated: Date.now(),
        };

        this.emitSnapshot();
        await this.refreshStatus({ refreshGit: true, forceGit: true });
        await this.refreshStatusScripts(true);
        await this.refreshSummaryScripts(true);
      } catch (error) {
        this.options.logger.warn(
          `[Panel] Failed to reload config: ${error instanceof Error ? error.message : error}`
        );
      } finally {
        this.configReloading = undefined;
      }
    })();

    await this.configReloading;
  }

  private async refreshStatus(options?: {
    refreshGit?: boolean;
    forceGit?: boolean;
  }): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.refreshing) {
      return this.refreshing;
    }

    this.refreshing = (async () => {
      const totalStart = Date.now();
      const fetchStart = totalStart;
      const statusMap = await this.options.fetchStatus();
      const fetchMs = Date.now() - fetchStart;

      const targets = this.options.config.targets.map((target) => ({
        name: target.name,
        status: (statusMap[target.name] as StatusObject) || { status: 'unknown' },
        targetType: target.type,
        enabled: target.enabled,
        group: target.group,
        // Preserve log channels so the panel keeps per-target log routing after refresh.
        logChannels: normalizeLogChannels(target.logChannels),
      }));

      const summary = computeSummary(targets, {
        scriptFailures: this.snapshot.summary.scriptFailures ?? 0,
      });
      const paused = Boolean((statusMap as any)._paused);
      let git = this.snapshot.git;
      let gitMs = 0;
      if (options?.refreshGit) {
        const gitStart = Date.now();
        git = await this.gitCollector.refresh(this.options.projectRoot, options.forceGit);
        gitMs = Date.now() - gitStart;
      }

      const emitStart = Date.now();
      this.snapshot = {
        targets,
        summary,
        git,
        projectName: this.snapshot.projectName,
        projectRoot: this.snapshot.projectRoot,
        preferredIndex: computePreferredIndex(targets),
        lastUpdated: Date.now(),
        statusScripts: this.snapshot.statusScripts,
        summaryScripts: this.snapshot.summaryScripts,
        paused,
      };

      this.emitSnapshot();
      this.emitter.emit('log-update');
      const emitMs = Date.now() - emitStart;

      const totalMs = Date.now() - totalStart;
      if (this.profileEnabled) {
        this.options.logger.info(
          `[PanelProfile] refreshStatus total=${totalMs}ms fetch=${fetchMs}ms git=${gitMs}ms emit=${emitMs}ms`
        );
      }

      void this.refreshStatusScripts();
      void this.refreshSummaryScripts();
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
    if (this.disposed || !this.options.config.statusScripts?.length) {
      return;
    }

    if (this.scriptRefreshing) {
      this.pendingStatusScripts = this.pendingStatusScripts || Boolean(force);
      return this.scriptRefreshing;
    }

    this.scriptRefreshing = (async () => {
      const totalStart = Date.now();
      const configs = this.options.config.statusScripts ?? [];
      const now = Date.now();

      // Emit cached results immediately so the panel shows something while scripts rerun.
      const cachedResults: PanelStatusScriptResult[] = [];
      for (const scriptConfig of configs) {
        const cacheKey = this.getScriptCacheKey(scriptConfig);
        const cache = this.scriptCache.get(cacheKey);
        const cooldownMs = (scriptConfig.cooldownSeconds ?? 60) * 1000;
        if (!force && cache && now - cache.lastRun < cooldownMs) {
          cachedResults.push(cache.result);
        }
      }
      if (cachedResults.length > 0) {
        this.snapshot = {
          ...this.snapshot,
          statusScripts: cachedResults,
          lastUpdated: Date.now(),
        };
        this.emitSnapshot();
      }

      // Run scripts in parallel and update incrementally.
      let scriptFailures = 0;
      const jobs = configs.map(async (scriptConfig) => {
        const cacheKey = this.getScriptCacheKey(scriptConfig);
        const cache = this.scriptCache.get(cacheKey);
        const cooldownMs = (scriptConfig.cooldownSeconds ?? 60) * 1000;
        if (!force && cache && now - cache.lastRun < cooldownMs) {
          if ((cache.result.exitCode ?? 0) !== 0) {
            scriptFailures += 1;
          }
          return cache.result;
        }

        const scriptStart = Date.now();
        const result = await this.runStatusScript(scriptConfig, this.options.projectRoot);
        const scriptMs = Date.now() - scriptStart;
        if ((result.exitCode ?? 0) !== 0) {
          scriptFailures += 1;
          this.options.logger.warn(
            `[Panel] Status script "${scriptConfig.label}" exited ${result.exitCode}`
          );
          this.emitScriptEvent({
            kind: 'status',
            label: scriptConfig.label,
            targets: scriptConfig.targets,
            placement: undefined,
            exitCode: result.exitCode,
            timestamp: Date.now(),
          });
        }
        if (this.profileEnabled) {
          this.options.logger.info(
            `[PanelProfile] script ${scriptConfig.label ?? scriptConfig.command} ran in ${scriptMs}ms (exit ${result.exitCode ?? 0})`
          );
        }
        this.scriptCache.set(cacheKey, { lastRun: result.lastRun, result });

        const merged = this.mergeScriptResult(result);
        this.snapshot = {
          ...this.snapshot,
          summary: computeSummary(this.snapshot.targets, { scriptFailures }),
          statusScripts: merged,
          lastUpdated: Date.now(),
        };
        this.emitSnapshot();
        return result;
      });

      await Promise.allSettled(jobs);

      if (this.profileEnabled) {
        this.options.logger.info(
          `[PanelProfile] refreshStatusScripts total=${Date.now() - totalStart}ms scripts=${configs.length}`
        );
      }
    })()
      .finally(() => {
        this.scriptRefreshing = undefined;
      })
      .finally(() => {
        if (this.pendingStatusScripts) {
          const rerunForce = this.pendingStatusScripts;
          this.pendingStatusScripts = false;
          void this.refreshStatusScripts(rerunForce);
        }
      });

    await this.scriptRefreshing;
  }

  private async refreshSummaryScripts(force?: boolean): Promise<void> {
    if (this.disposed || !this.options.config.summaryScripts?.length) {
      return;
    }

    if (this.summaryRefreshing) {
      this.pendingSummaryScripts = this.pendingSummaryScripts || Boolean(force);
      return this.summaryRefreshing;
    }

    this.summaryRefreshing = (async () => {
      const totalStart = Date.now();
      const configs = this.options.config.summaryScripts ?? [];
      const now = Date.now();

      const cached: PanelSummaryScriptResult[] = [];
      for (const scriptConfig of configs) {
        const cacheKey = this.getSummaryCacheKey(scriptConfig);
        const cache = this.summaryScriptCache.get(cacheKey);
        const refreshMs = (scriptConfig.refreshSeconds ?? 1800) * 1000;
        if (!force && cache && now - cache.lastRun < refreshMs) {
          cached.push(cache.result);
        }
      }

      if (cached.length > 0) {
        this.snapshot = {
          ...this.snapshot,
          summaryScripts: cached,
          lastUpdated: Date.now(),
        };
        this.emitSnapshot();
        this.emitter.emit('log-update');
      }

      const jobs = configs.map(async (scriptConfig) => {
        const cacheKey = this.getSummaryCacheKey(scriptConfig);
        const cache = this.summaryScriptCache.get(cacheKey);
        const refreshMs = (scriptConfig.refreshSeconds ?? 1800) * 1000;
        if (!force && cache && now - cache.lastRun < refreshMs) {
          return cache.result;
        }

        const scriptStart = Date.now();
        const result = await runSummaryScript(scriptConfig, this.options.projectRoot);
        const scriptMs = Date.now() - scriptStart;
        if (this.profileEnabled) {
          this.options.logger.info(
            `[PanelProfile] summary ${scriptConfig.label} ran in ${scriptMs}ms (exit ${result.exitCode ?? 0})`
          );
        }
        if ((result.exitCode ?? 0) !== 0) {
          this.options.logger.warn(
            `[Panel] Summary script "${scriptConfig.label}" exited ${result.exitCode}`
          );
          this.emitScriptEvent({
            kind: 'summary',
            label: scriptConfig.label,
            placement: result.placement,
            exitCode: result.exitCode,
            timestamp: Date.now(),
          });
        }

        this.summaryScriptCache.set(cacheKey, { lastRun: result.lastRun, result });
        const merged = this.mergeSummaryResult(result);
        this.snapshot = {
          ...this.snapshot,
          summaryScripts: merged,
          lastUpdated: Date.now(),
        };
        this.emitSnapshot();
        this.emitter.emit('log-update');
        return result;
      });

      await Promise.allSettled(jobs);

      if (this.profileEnabled) {
        this.options.logger.info(
          `[PanelProfile] refreshSummaryScripts total=${Date.now() - totalStart}ms scripts=${configs.length}`
        );
      }
    })()
      .finally(() => {
        this.summaryRefreshing = undefined;
      })
      .finally(() => {
        if (this.pendingSummaryScripts) {
          const rerunForce = this.pendingSummaryScripts;
          this.pendingSummaryScripts = false;
          void this.refreshSummaryScripts(rerunForce);
        }
      });

    await this.summaryRefreshing;
  }

  private getScriptCacheKey(script: StatusScriptConfig): string {
    const targetsKey = script.targets?.slice().sort().join(',') ?? '';
    return `${script.label}::${script.command}::${targetsKey}`;
  }

  private getSummaryCacheKey(script: SummaryScriptConfig): string {
    return `${script.label}::${script.command}::${script.placement ?? 'summary'}`;
  }

  private mergeScriptResult(result: PanelStatusScriptResult): PanelStatusScriptResult[] {
    const current = this.snapshot.statusScripts ?? [];
    const filtered = current.filter((r) => r.label !== result.label);
    return [...filtered, result];
  }

  private mergeSummaryResult(result: PanelSummaryScriptResult): PanelSummaryScriptResult[] {
    const current = this.snapshot.summaryScripts ?? [];
    const filtered = current.filter(
      (r) => !(r.label === result.label && r.placement === result.placement)
    );
    return [...filtered, result];
  }

  private emitSnapshot(): void {
    // Shallow-freeze the snapshot to guard against accidental listener mutation.
    const frozen = Object.freeze({ ...this.snapshot }) as PanelSnapshot;
    this.emitter.emit('update', { snapshot: frozen });
  }

  private emitScriptEvent(event: ScriptEvent): void {
    this.emitter.emit('script-event', event);
    this.options.scriptEventSink?.(event);
  }
}

interface CachedStatusScript {
  lastRun: number;
  result: PanelStatusScriptResult;
}

interface CachedSummaryScript {
  lastRun: number;
  result: PanelSummaryScriptResult;
}
