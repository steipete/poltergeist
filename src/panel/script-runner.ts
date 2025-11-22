import { exec } from 'child_process';
import { promisify } from 'util';
import type { StatusScriptConfig, SummaryScriptConfig } from '../types.js';
import { formatTestOutput } from '../utils/test-formatter.js';
import type { PanelStatusScriptResult, PanelSummaryScriptResult } from './types.js';

const execAsync = promisify(exec);
const DEFAULT_MAX_BUFFER = 1024 * 1024;

interface ScriptExecutionOptions {
  projectRoot: string;
  timeoutSeconds?: number;
  maxLines: number;
  formatter?: 'auto' | 'none' | 'swift' | 'ts';
}

interface ScriptExecutionResult {
  lines: string[];
  exitCode: number | null;
  durationMs: number;
  lastRun: number;
  maxLines: number;
}

export function extractLines(stdout?: string, stderr?: string, maxLines: number = 1): string[] {
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

async function executeScript(
  command: string,
  options: ScriptExecutionOptions
): Promise<ScriptExecutionResult> {
  const now = Date.now();
  const execOptions = {
    cwd: options.projectRoot,
    timeout: (options.timeoutSeconds ?? 30) * 1000,
    maxBuffer: DEFAULT_MAX_BUFFER,
    env: { ...process.env, FORCE_COLOR: '0' },
  } as const;

  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, execOptions);
    const durationMs = Date.now() - start;
    const fullLines = extractLines(stdout, stderr, 1000);
    const formatted = formatTestOutput(fullLines, options.formatter ?? 'auto', command);
    const lines = formatted.slice(0, options.maxLines);
    return {
      lines,
      exitCode: 0,
      durationMs,
      lastRun: now,
      maxLines: options.maxLines,
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const fullLines = extractLines(execError.stdout, execError.stderr, 1000);
    if (fullLines.length === 0) {
      fullLines.push(`Error: ${execError.message}`);
    }
    const formatted = formatTestOutput(fullLines, options.formatter ?? 'auto', command);
    const lines = formatted.slice(0, options.maxLines);
    return {
      lines,
      exitCode:
        typeof execError.code === 'number'
          ? execError.code
          : typeof execError.code === 'string'
            ? Number.parseInt(execError.code, 10)
            : null,
      durationMs,
      lastRun: now,
      maxLines: options.maxLines,
    };
  }
}

export async function runStatusScript(
  script: StatusScriptConfig,
  projectRoot: string
): Promise<PanelStatusScriptResult> {
  const result = await executeScript(script.command, {
    projectRoot,
    timeoutSeconds: script.timeoutSeconds,
    maxLines: script.maxLines ?? 1,
    formatter: script.formatter,
  });

  return {
    label: script.label,
    lines: result.lines,
    targets: script.targets,
    lastRun: result.lastRun,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    maxLines: result.maxLines,
  };
}

export async function runSummaryScript(
  script: SummaryScriptConfig,
  projectRoot: string
): Promise<PanelSummaryScriptResult> {
  const result = await executeScript(script.command, {
    projectRoot,
    timeoutSeconds: script.timeoutSeconds,
    maxLines: script.maxLines ?? 10,
    formatter: script.formatter,
  });

  // Allow scripts to override the badge dynamically via a marker line.
  // First non-empty line matching @count: or @badge: <text> becomes the badge and is stripped.
  const lines = [...result.lines];
  let dynamicCount: string | number | null | undefined = script.countLabel;
  if (dynamicCount === undefined && lines.length > 0) {
    const first = lines[0];
    const match = first.match(/^@(?:count|badge):\s*(.+)$/i);
    if (match) {
      dynamicCount = match[1].trim();
      lines.shift();
    }
  }

  return {
    label: script.label,
    lines,
    lastRun: result.lastRun,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    placement: script.placement ?? 'summary',
    maxLines: result.maxLines,
    formatter: script.formatter,
    countLabel: dynamicCount,
  };
}
