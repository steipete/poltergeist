import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CLAUDE_SUMMARY_PROMPT =
  'Write a concise single-sentence headline summarizing the most important dirty-file changes, then output a 5-item bullet list. Read the diffs carefully and focus on user-visible impact. Never use filler like "Here is a summary" or "Now that I have context"—start with the headline (no prefix), then the list. Keep each bullet under 120 characters.';

export interface GitMetrics {
  dirtyFiles: number;
  dirtyFileNames: string[];
  insertions: number;
  deletions: number;
  branch?: string;
  ahead?: number;
  behind?: number;
  upstream?: string;
  lastFetchedAt?: number;
  hasRepo: boolean;
  lastUpdated: number;
  summary?: string[];
  summaryMode?: 'list' | 'ai';
}

type GitCommandRunner = (args: string[], cwd: string) => Promise<string>;

export interface GitMetricsOptions {
  throttleMs?: number;
  runner?: GitCommandRunner;
  summaryMode?: 'list' | 'ai';
  logger?: { warn(message: string): void };
}

function defaultRunner(args: string[], cwd: string): Promise<string> {
  return execFileAsync('git', args, {
    cwd,
    timeout: 2000,
    maxBuffer: 1024 * 1024,
  }).then(({ stdout }) => stdout);
}

export class GitMetricsCollector {
  private cache = new Map<string, GitMetrics>();
  private inflight = new Map<string, Promise<GitMetrics>>();
  private readonly throttleMs: number;
  private readonly runner: GitCommandRunner;
  private readonly summaryMode: 'list' | 'ai';
  private readonly logger?: { warn(message: string): void };
  private summaryJobs = new Map<string, Promise<void>>();
  private summaryCooldownUntil = new Map<string, number>();
  private summaryCache = new Map<string, string[] | undefined>();
  private summarySignatures = new Map<string, string>();
  private upstreamCooldownUntil = new Map<string, number>();

  constructor(options: GitMetricsOptions = {}) {
    this.throttleMs = options.throttleMs ?? 5000;
    this.runner = options.runner ?? defaultRunner;
    this.summaryMode = options.summaryMode ?? 'ai';
    this.logger = options.logger;
  }

  public getCached(projectRoot: string): GitMetrics | undefined {
    return this.cache.get(projectRoot);
  }

  public async refresh(projectRoot: string, force = false): Promise<GitMetrics> {
    const cached = this.cache.get(projectRoot);
    if (
      !force &&
      cached &&
      Date.now() - cached.lastUpdated < this.throttleMs &&
      !this.inflight.has(projectRoot)
    ) {
      return cached;
    }

    if (!force) {
      const inflightExisting = this.inflight.get(projectRoot);
      if (inflightExisting) {
        return inflightExisting;
      }
    }

    const promise = this.collect(projectRoot).finally(() => {
      this.inflight.delete(projectRoot);
    });

    this.inflight.set(projectRoot, promise);
    return promise;
  }

  private async collect(projectRoot: string): Promise<GitMetrics> {
    try {
      const statusRaw = await this.runner(
        ['status', '--porcelain=v2', '--branch', '-z'],
        projectRoot
      );
      const { count: dirtyFiles, files: dirtyFileNames } = this.parseDirtyFiles(statusRaw);
      const branch = this.parseBranch(statusRaw);

      const diffRaw = await this.runner(['diff', '--shortstat', 'HEAD'], projectRoot).catch(
        () => ''
      );
      const { insertions, deletions } = this.parseDiffStats(diffRaw);
      const summary = this.summaryMode === 'ai' ? this.summaryCache.get(projectRoot) : undefined;
      const upstream = await this.maybeRefreshUpstream(projectRoot, branch);

      const metrics: GitMetrics = {
        dirtyFiles,
        dirtyFileNames,
        insertions,
        deletions,
        branch,
        ahead: upstream?.ahead ?? this.cache.get(projectRoot)?.ahead,
        behind: upstream?.behind ?? this.cache.get(projectRoot)?.behind,
        upstream: upstream?.upstream ?? this.cache.get(projectRoot)?.upstream,
        lastFetchedAt: upstream?.lastFetchedAt ?? this.cache.get(projectRoot)?.lastFetchedAt,
        hasRepo: true,
        lastUpdated: Date.now(),
        summary,
        summaryMode: this.summaryMode,
      };

      this.cache.set(projectRoot, metrics);

      if (dirtyFiles === 0) {
        this.summaryCache.delete(projectRoot);
        this.summaryCooldownUntil.delete(projectRoot);
        this.summarySignatures.delete(projectRoot);
      } else {
        void this.maybeStartSummaryJob(projectRoot, dirtyFiles, insertions, deletions);
      }

      return metrics;
    } catch {
      const fallback: GitMetrics = {
        dirtyFiles: 0,
        dirtyFileNames: [],
        insertions: 0,
        deletions: 0,
        branch: undefined,
        hasRepo: false,
        lastUpdated: Date.now(),
        summaryMode: this.summaryMode,
      };
      this.cache.set(projectRoot, fallback);
      return fallback;
    }
  }

  private async maybeRefreshUpstream(
    projectRoot: string,
    branch?: string
  ): Promise<{ ahead: number; behind: number; upstream: string; lastFetchedAt: number } | null> {
    if (!branch) return null;
    const now = Date.now();
    const cooldownUntil = this.upstreamCooldownUntil.get(projectRoot) ?? 0;
    if (now < cooldownUntil) {
      const cached = this.cache.get(projectRoot);
      return cached?.upstream
        ? {
            ahead: cached.ahead ?? 0,
            behind: cached.behind ?? 0,
            upstream: cached.upstream,
            lastFetchedAt: cached.lastFetchedAt ?? 0,
          }
        : null;
    }

    // Update immediately, then set cooldown (2 minutes) to avoid frequent fetches.
    this.upstreamCooldownUntil.set(projectRoot, now + 120_000);
    try {
      const upstream = `origin/${branch}`;
      await this.runner(
        ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', branch],
        projectRoot
      );
      const aheadRaw = await this.runner(
        ['rev-list', '--count', `${upstream}..HEAD`],
        projectRoot
      ).catch(() => '0');
      const behindRaw = await this.runner(
        ['rev-list', '--count', `HEAD..${upstream}`],
        projectRoot
      ).catch(() => '0');
      return {
        ahead: Number.parseInt(aheadRaw.trim() || '0', 10) || 0,
        behind: Number.parseInt(behindRaw.trim() || '0', 10) || 0,
        upstream,
        lastFetchedAt: Date.now(),
      };
    } catch (error) {
      this.logger?.warn?.(
        `[Panel] Failed to refresh upstream status: ${error instanceof Error ? error.message : error}`
      );
      return null;
    }
  }

  private parseDirtyFiles(raw: string): { count: number; files: string[] } {
    if (!raw) return { count: 0, files: [] };
    const entries = raw.split('\0').filter((line) => line.length > 0);
    const files: string[] = [];
    for (const line of entries) {
      if (!/^[12u?]/.test(line)) continue;
      const path = this.extractPathFromStatus(line);
      if (path) {
        files.push(path);
        if (files.length >= 10) {
          break;
        }
      }
    }
    const count = entries.filter((line) => /^[12u?]/.test(line)).length;
    return { count, files };
  }

  private extractPathFromStatus(line: string): string | null {
    if (line.startsWith('?')) {
      return line.replace(/^\?\s+/, '').trim() || null;
    }
    const tabIndex = line.indexOf('\t');
    if (tabIndex >= 0) {
      const remainder = line.slice(tabIndex + 1);
      const parts = remainder.split('\t');
      return parts[parts.length - 1]?.trim() || null;
    }
    const segments = line.trim().split(/\s+/);
    return segments.length > 0 ? segments[segments.length - 1] : null;
  }

  private parseBranch(raw: string): string | undefined {
    if (!raw) return undefined;
    const branchLine = raw.split('\0').find((line) => line.startsWith('# branch.head '));
    if (!branchLine) return undefined;
    const parts = branchLine.split(' ');
    return parts[2] && parts[2] !== '(detached)' ? parts[2] : undefined;
  }

  private parseDiffStats(raw: string): { insertions: number; deletions: number } {
    if (!raw) {
      return { insertions: 0, deletions: 0 };
    }
    const insertionMatch = raw.match(/(\d+)\s+insertions?\(\+\)/);
    const deletionMatch = raw.match(/(\d+)\s+deletions?\(-\)/);
    return {
      insertions: insertionMatch ? Number.parseInt(insertionMatch[1], 10) : 0,
      deletions: deletionMatch ? Number.parseInt(deletionMatch[1], 10) : 0,
    };
  }

  private maybeStartSummaryJob(
    projectRoot: string,
    dirtyCount: number,
    insertions: number,
    deletions: number
  ): void {
    if (this.summaryMode !== 'ai' || dirtyCount === 0) {
      return;
    }
    if (this.summaryJobs.has(projectRoot)) {
      return;
    }
    const cooldownUntil = this.summaryCooldownUntil.get(projectRoot);
    const now = Date.now();
    if (cooldownUntil && now < cooldownUntil) {
      return;
    }

    const signature = `${dirtyCount}:${insertions}:${deletions}`;
    const previousSignature = this.summarySignatures.get(projectRoot);
    if (previousSignature === signature) {
      return;
    }

    const job = this.runClaudeSummary(projectRoot)
      .then((lines) => {
        this.summaryCache.set(projectRoot, lines);
        this.summarySignatures.set(projectRoot, signature);
        const cached = this.cache.get(projectRoot);
        if (cached) {
          const updated: GitMetrics = {
            ...cached,
            summary: lines,
            lastUpdated: Date.now(),
          };
          this.cache.set(projectRoot, updated);
        }
      })
      .catch((error) => {
        this.logger?.warn?.(
          `[Panel] Failed to summarize dirty files via Claude: ${
            error instanceof Error ? error.message : error
          }`
        );
        this.summaryCache.set(projectRoot, undefined);
      })
      .finally(() => {
        this.summaryJobs.delete(projectRoot);
        this.summaryCooldownUntil.set(projectRoot, Date.now() + this.throttleMs);
      });

    this.summaryJobs.set(projectRoot, job);
  }

  private runClaudeSummary(projectRoot: string): Promise<string[] | undefined> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'bash',
        [
          '-lc',
          `claude -p ${JSON.stringify(
            CLAUDE_SUMMARY_PROMPT
          )} --dangerously-skip-permissions --model haiku`,
        ],
        {
          cwd: projectRoot,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.once('error', (error) => {
        reject(error);
      });

      child.once('close', (code) => {
        if (code !== 0) {
          const message = stderr.trim() || `Claude exited with code ${code ?? -1}`;
          reject(new Error(message));
          return;
        }
        const lines = stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, 5);
        resolve(lines.length > 0 ? lines : undefined);
      });
    });
  }
}
