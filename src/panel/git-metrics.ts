import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitMetrics {
  dirtyFiles: number;
  dirtyFileNames: string[];
  insertions: number;
  deletions: number;
  branch?: string;
  hasRepo: boolean;
  lastUpdated: number;
}

type GitCommandRunner = (args: string[], cwd: string) => Promise<string>;

export interface GitMetricsOptions {
  throttleMs?: number;
  runner?: GitCommandRunner;
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

  constructor(options: GitMetricsOptions = {}) {
    this.throttleMs = options.throttleMs ?? 5000;
    this.runner = options.runner ?? defaultRunner;
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

    if (!force && this.inflight.has(projectRoot)) {
      return this.inflight.get(projectRoot)!;
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

      const diffRaw = await this.runner(['diff', '--shortstat', 'HEAD'], projectRoot).catch(() => '');
      const { insertions, deletions } = this.parseDiffStats(diffRaw);

      const metrics: GitMetrics = {
        dirtyFiles,
        dirtyFileNames,
        insertions,
        deletions,
        branch,
        hasRepo: true,
        lastUpdated: Date.now(),
      };

      this.cache.set(projectRoot, metrics);
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
      };
      this.cache.set(projectRoot, fallback);
      return fallback;
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
        if (files.length >= 20) {
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
    const branchLine = raw
      .split('\0')
      .find((line) => line.startsWith('# branch.head '));
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
}
