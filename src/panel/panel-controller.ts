import { exec } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, type FSWatcher, mkdirSync, watch } from 'fs';
import { promisify } from 'util';
import type { StatusObject } from '../status/types.js';
import type { StatusScriptConfig, SummaryScriptConfig } from '../types.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import { formatTestOutput } from '../utils/test-formatter.js';
import { GitMetricsCollector } from './git-metrics.js';
import { LogTailReader } from './log-reader.js';
import { normalizeLogChannels } from '../utils/log-channels.js';
import type {
  PanelControllerOptions,
  PanelSnapshot,
  PanelStatusScriptResult,
  PanelSummaryScriptResult,
  TargetPanelEntry,
} from './types.js';

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
  private summaryRefreshing?: Promise<void>;
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
    this.logReader = new LogTailReader(options.projectRoot, { maxLines: 200 });
    this.gitPollMs = options.gitPollIntervalMs ?? 5000;
    this.statusPollMs = options.statusPollIntervalMs ?? 2000;
    this.scriptCache = new Map();
    this.summaryScriptCache = new Map();
    this.profileEnabled = process.env.POLTERGEIST_PANEL_PROFILE === '1';
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
      statusScripts: [],
      summaryScripts: [],
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
    // Kick scripts asynchronously so the panel can render immediately.
    void this.refreshStatusScripts(true);
    void this.refreshSummaryScripts(true);
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

  public async getLogLines(targetName: string, channel?: string, limit?: number): Promise<string[]> {
    return this.logReader.read(targetName, channel, limit);
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

  private computeSummary(
    targets: TargetPanelEntry[],
    scriptFailuresOverride?: number
  ): PanelSnapshot['summary'] {
    const activeDaemonKeys = new Set<string>();
    const summary = targets.reduce<PanelSnapshot['summary']>(
      (acc, entry) => {
        acc.totalTargets += 1;
        if (entry.status.lastBuild?.status === 'building') {
          acc.building += 1;
        } else if (entry.status.lastBuild?.status === 'failure') {
          acc.failures += 1;
          acc.targetFailures = (acc.targetFailures ?? 0) + 1;
        }
        if (entry.status.process?.isActive) {
          const pid = entry.status.process.pid;
          const key =
            typeof pid === 'number' || typeof pid === 'string'
              ? String(pid)
              : `target:${entry.name}`;
          activeDaemonKeys.add(key);
        }
        return acc;
      },
      {
        totalTargets: 0,
        building: 0,
        failures: 0,
        targetFailures: 0,
        scriptFailures: scriptFailuresOverride ?? this.snapshot.summary.scriptFailures ?? 0,
        running: 0,
        activeDaemons: [],
      }
    );

    const targetFailures = summary.targetFailures ?? 0;
    const scriptFailures = summary.scriptFailures ?? 0;
    summary.failures = targetFailures + scriptFailures;
    summary.running = activeDaemonKeys.size;
    summary.activeDaemons = Array.from(activeDaemonKeys);
    return summary;
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

      const summary = this.computeSummary(targets);
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
        preferredIndex: this.computePreferredIndex(targets),
        lastUpdated: Date.now(),
        statusScripts: this.snapshot.statusScripts,
        summaryScripts: this.snapshot.summaryScripts,
      };

      this.emitter.emit('update', { snapshot: this.snapshot });
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
        this.emitter.emit('update', { snapshot: this.snapshot });
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
        const result = await this.runStatusScript(scriptConfig);
        const scriptMs = Date.now() - scriptStart;
        if ((result.exitCode ?? 0) !== 0) {
          scriptFailures += 1;
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
          summary: this.computeSummary(this.snapshot.targets, scriptFailures),
          statusScripts: merged,
          lastUpdated: Date.now(),
        };
        this.emitter.emit('update', { snapshot: this.snapshot });
        return result;
      });

      await Promise.allSettled(jobs);

      if (this.profileEnabled) {
        this.options.logger.info(
          `[PanelProfile] refreshStatusScripts total=${Date.now() - totalStart}ms scripts=${configs.length}`
        );
      }
    })().finally(() => {
      this.scriptRefreshing = undefined;
    });

    await this.scriptRefreshing;
  }

  private async refreshSummaryScripts(force?: boolean): Promise<void> {
    if (this.disposed || !this.options.config.summaryScripts?.length) {
      return;
    }

    if (this.summaryRefreshing) {
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
        this.emitter.emit('update', { snapshot: this.snapshot });
      }

      const jobs = configs.map(async (scriptConfig) => {
        const cacheKey = this.getSummaryCacheKey(scriptConfig);
        const cache = this.summaryScriptCache.get(cacheKey);
        const refreshMs = (scriptConfig.refreshSeconds ?? 1800) * 1000;
        if (!force && cache && now - cache.lastRun < refreshMs) {
          return cache.result;
        }

        const scriptStart = Date.now();
        const result = await this.runSummaryScript(scriptConfig);
        const scriptMs = Date.now() - scriptStart;
        if (this.profileEnabled) {
          this.options.logger.info(
            `[PanelProfile] summary ${scriptConfig.label} ran in ${scriptMs}ms (exit ${result.exitCode ?? 0})`
          );
        }

        this.summaryScriptCache.set(cacheKey, { lastRun: result.lastRun, result });
        const merged = this.mergeSummaryResult(result);
        this.snapshot = {
          ...this.snapshot,
          summaryScripts: merged,
          lastUpdated: Date.now(),
        };
        this.emitter.emit('update', { snapshot: this.snapshot });
        return result;
      });

      await Promise.allSettled(jobs);

      if (this.profileEnabled) {
        this.options.logger.info(
          `[PanelProfile] refreshSummaryScripts total=${Date.now() - totalStart}ms scripts=${configs.length}`
        );
      }
    })().finally(() => {
      this.summaryRefreshing = undefined;
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
    const filtered = current.filter((r) => !(r.label === result.label && r.placement === result.placement));
    return [...filtered, result];
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
      const fullLines = this.extractLines(stdout, stderr, 1000);
      const formatted = formatTestOutput(fullLines, script.formatter ?? 'auto', script.command);
      const lines = formatted.slice(0, maxLines);
      return {
        label: script.label,
        lines,
        targets: script.targets,
        lastRun: now,
        exitCode: 0,
        durationMs,
        maxLines,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      const fullLines = this.extractLines(execError.stdout, execError.stderr, 1000);
      if (fullLines.length === 0) {
        fullLines.push(`Error: ${execError.message}`);
      }
      const formatted = formatTestOutput(fullLines, script.formatter ?? 'auto', script.command);
      const lines = formatted.slice(0, maxLines);
      return {
        label: script.label,
        lines,
        targets: script.targets,
        lastRun: now,
        exitCode:
          typeof execError.code === 'number'
            ? execError.code
            : typeof execError.code === 'string'
              ? Number.parseInt(execError.code, 10)
              : null,
        durationMs,
        maxLines,
      };
    }
  }

  private async runSummaryScript(script: SummaryScriptConfig): Promise<PanelSummaryScriptResult> {
    const now = Date.now();
    const maxLines = script.maxLines ?? 10;
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
      const fullLines = this.extractLines(stdout, stderr, 1000);
      const formatted = formatTestOutput(fullLines, script.formatter ?? 'auto', script.command);
      const lines = formatted.slice(0, maxLines);
      return {
        label: script.label,
        lines,
        lastRun: now,
        exitCode: 0,
        durationMs,
        placement: script.placement ?? 'summary',
        maxLines,
        formatter: script.formatter,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      const fullLines = this.extractLines(execError.stdout, execError.stderr, 1000);
      if (fullLines.length === 0) {
        fullLines.push(`Error: ${execError.message}`);
      }
      const formatted = formatTestOutput(fullLines, script.formatter ?? 'auto', script.command);
      const lines = formatted.slice(0, maxLines);
      return {
        label: script.label,
        lines,
        lastRun: now,
        exitCode:
          typeof execError.code === 'number'
            ? execError.code
            : typeof execError.code === 'string'
              ? Number.parseInt(execError.code, 10)
              : null,
        durationMs,
        placement: script.placement ?? 'summary',
        maxLines,
        formatter: script.formatter,
      };
    }
  }

  private extractLines(stdout?: string, stderr?: string, maxLines: number = 1): string[] {
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

interface CachedSummaryScript {
  lastRun: number;
  result: PanelSummaryScriptResult;
}
