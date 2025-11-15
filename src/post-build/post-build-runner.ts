import { type ChildProcess, spawn } from 'child_process';
import path from 'path';
import type { IStateManager } from '../interfaces.js';
import type { Logger } from '../logger.js';
import type { PostBuildCommandConfig } from '../types.js';

type Trigger = 'success' | 'failure';

interface PostBuildRunnerOptions {
  targetName: string;
  hooks: PostBuildCommandConfig[];
  projectRoot: string;
  stateManager: IStateManager;
  logger: Logger;
}

interface QueueEntry {
  hook: PostBuildCommandConfig;
  trigger: Trigger;
}

interface FormattedResult {
  summary?: string;
  lines?: string[];
  status?: 'success' | 'failure';
}

export class PostBuildRunner {
  private queue: QueueEntry[] = [];
  private processing = false;
  private currentChild?: ChildProcess;
  private timeoutHandle?: NodeJS.Timeout;

  constructor(private readonly options: PostBuildRunnerOptions) {}

  public onBuildResult(status: Trigger): void {
    const eligible = this.options.hooks.filter((hook) => this.shouldRun(hook, status));
    if (eligible.length === 0) {
      return;
    }

    this.queue.push(...eligible.map((hook) => ({ hook, trigger: status })));
    void this.processQueue();
  }

  public async stop(): Promise<void> {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    if (this.currentChild) {
      this.currentChild.kill('SIGTERM');
    }
  }

  private shouldRun(hook: PostBuildCommandConfig, status: Trigger): boolean {
    const runOn = hook.runOn;
    if (!runOn) {
      return status === 'success';
    }
    if (Array.isArray(runOn)) {
      if (runOn.includes('always')) {
        return true;
      }
      return runOn.includes(status);
    }
    if (runOn === 'always') {
      return true;
    }
    return runOn === status;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) {
        break;
      }
      try {
        await this.runHook(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.logger.warn(
          `[PostBuild] ${this.options.targetName}/${job.hook.name} failed: ${message}`
        );
      }
    }

    this.processing = false;
  }

  private async runHook(job: QueueEntry): Promise<void> {
    const { hook, trigger } = job;
    const startedAt = new Date();
    await this.options.stateManager.updatePostBuildResult(this.options.targetName, hook.name, {
      status: 'running',
      summary: `${hook.name} running after ${trigger}`,
      startedAt: startedAt.toISOString(),
      trigger,
    });

    const result = await this.executeCommand(hook);
    const formatted = await this.formatResult(hook, result.stdout, result.stderr, result.exitCode);
    const success = result.exitCode === 0;
    const finalStatus = formatted?.status ?? (success ? 'success' : 'failure');
    const durationMs = Date.now() - startedAt.getTime();
    const maxLines = hook.maxLines ?? 5;
    const fallbackLines = this.tailLines(`${result.stdout}\n${result.stderr}`, maxLines);
    const resolvedLines = formatted?.lines?.length ? formatted.lines : fallbackLines;

    await this.options.stateManager.updatePostBuildResult(this.options.targetName, hook.name, {
      status: finalStatus,
      summary:
        formatted?.summary ??
        `${hook.name}: ${success ? 'passed' : 'failed'} (exit ${result.exitCode ?? -1})`,
      lines: resolvedLines.length ? resolvedLines : undefined,
      completedAt: new Date().toISOString(),
      durationMs,
      exitCode: result.exitCode ?? undefined,
      formatterError: result.executionNote,
    });
  }

  private getWorkingDirectory(hook: PostBuildCommandConfig): string {
    if (!hook.cwd) {
      return this.options.projectRoot;
    }
    if (path.isAbsolute(hook.cwd)) {
      return hook.cwd;
    }
    return path.resolve(this.options.projectRoot, hook.cwd);
  }

  private executeCommand(hook: PostBuildCommandConfig): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    executionNote?: string;
  }> {
    return new Promise((resolve) => {
      const cwd = this.getWorkingDirectory(hook);
      const env = {
        ...process.env,
        ...hook.env,
      };

      const child = spawn(hook.command, {
        cwd,
        env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.currentChild = child;
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout?.on('data', (chunk) => {
        stdoutChunks.push(chunk.toString());
      });
      child.stderr?.on('data', (chunk) => {
        stderrChunks.push(chunk.toString());
      });

      let timedOut = false;
      if (hook.timeoutSeconds && hook.timeoutSeconds > 0) {
        this.timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, hook.timeoutSeconds * 1000);
      }

      child.on('close', (code) => {
        if (this.timeoutHandle) {
          clearTimeout(this.timeoutHandle);
          this.timeoutHandle = undefined;
        }
        this.currentChild = undefined;
        resolve({
          stdout: stdoutChunks.join(''),
          stderr: stderrChunks.join(''),
          exitCode: timedOut ? -1 : code,
          executionNote: timedOut ? 'timeout' : undefined,
        });
      });
    });
  }

  private async formatResult(
    hook: PostBuildCommandConfig,
    stdout: string,
    stderr: string,
    exitCode: number | null
  ): Promise<FormattedResult | undefined> {
    let parsed = this.tryParseJsonResult(stdout);

    if (!parsed && hook.formatter) {
      parsed = await this.runFormatter(hook, stdout, stderr, exitCode ?? -1);
    }

    if (parsed?.lines && hook.maxLines && parsed.lines.length > hook.maxLines) {
      parsed.lines = parsed.lines.slice(0, hook.maxLines);
    }
    if (parsed?.lines) {
      parsed.lines = parsed.lines.map((line) => line.trim()).filter((line) => line.length > 0);
    }

    return parsed;
  }

  private tryParseJsonResult(payload: string): FormattedResult | undefined {
    const trimmed = payload.trim();
    if (!trimmed) {
      return undefined;
    }

    const candidates: string[] = [];
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim());

    for (const line of [...lines].reverse()) {
      if (line.startsWith('POLTERGEIST_POSTBUILD_RESULT:')) {
        candidates.unshift(line.replace('POLTERGEIST_POSTBUILD_RESULT:', '').trim());
        break;
      }
      if (line.startsWith('{') || line.startsWith('[')) {
        candidates.unshift(line);
        break;
      }
    }

    if (candidates.length === 0 && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      candidates.push(trimmed);
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) {
          return { lines: parsed.map((value) => String(value)) };
        }
        if (typeof parsed === 'object' && parsed) {
          return {
            summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
            lines: Array.isArray(parsed.lines)
              ? parsed.lines.map((value: unknown) => String(value))
              : undefined,
            status:
              parsed.status === 'success' || parsed.status === 'failure'
                ? parsed.status
                : undefined,
          };
        }
      } catch {
        // ignore parse errors
      }
    }

    return undefined;
  }

  private async runFormatter(
    hook: PostBuildCommandConfig,
    stdout: string,
    stderr: string,
    exitCode: number
  ): Promise<FormattedResult | undefined> {
    return new Promise((resolve) => {
      const formatter = spawn(hook.formatter as string, {
        cwd: this.getWorkingDirectory(hook),
        env: {
          ...process.env,
          ...hook.env,
          POLTERGEIST_POSTBUILD_EXIT_CODE: String(exitCode),
          POLTERGEIST_POSTBUILD_STDERR: stderr,
        },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      formatter.stdout?.on('data', (chunk) => {
        output += chunk.toString();
      });

      formatter.stdin?.write(stdout);
      formatter.stdin?.end();

      formatter.on('close', (code) => {
        if (code !== 0) {
          resolve(undefined);
          return;
        }
        try {
          const parsed = JSON.parse(output.trim());
          if (parsed) {
            resolve({
              summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
              lines: Array.isArray(parsed.lines)
                ? parsed.lines.map((value: unknown) => String(value))
                : undefined,
              status:
                parsed.status === 'success' || parsed.status === 'failure'
                  ? parsed.status
                  : undefined,
            });
            return;
          }
        } catch {
          // ignored
        }
        resolve(undefined);
      });
    });
  }

  private tailLines(payload: string, limit: number): string[] {
    if (!payload) {
      return [];
    }
    return payload
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-limit);
  }
}
