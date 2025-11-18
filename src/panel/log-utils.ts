import wrapAnsi from 'wrap-ansi';
import { colors } from './render-utils.js';
import { centerText } from './text-utils.js';
import type { TargetPanelEntry } from './types.js';

// blank spacer + header + divider inside formatLogs
export const LOG_OVERHEAD_LINES = 3;

const TEST_LOG_PATTERN = /\b(test(ing)?|tests|suite|spec|describe|it|passed|failed)\b/i;

export function filterTestLogs(lines: string[]): string[] {
  const filtered = lines.filter((line) => TEST_LOG_PATTERN.test(line));
  return filtered.length > 0 ? filtered : lines;
}

export function filterBuildLogs(lines: string[]): string[] {
  const filtered = lines.filter((line) => !TEST_LOG_PATTERN.test(line));
  return filtered.length > 0 ? filtered : lines;
}

export function formatLogs(
  entry: TargetPanelEntry | undefined,
  channel: string,
  lines: string[],
  width: number,
  maxLines: number,
  viewMode: 'all' | 'tests'
): string {
  const safeLines = Array.isArray(lines) ? lines : [];
  const targetName = entry?.name ?? 'Unknown';
  const statusLabel =
    entry?.status?.lastBuild?.status ??
    entry?.status?.status ??
    entry?.status?.lastBuild?.status ??
    '';
  const header = colors.header(
    `Logs — ${targetName}${statusLabel ? ` (${statusLabel})` : ''} · ${channel}${
      viewMode === 'tests' ? ' [tests]' : ''
    }`
  );
  const divider = colors.line('─'.repeat(Math.max(4, width)));
  const wrapped: string[] = [];
  const wrapWidth = Math.max(1, width - 2);
  for (const line of safeLines) {
    const logicalLines = String(line ?? '').split(/\r?\n/);
    for (const logical of logicalLines) {
      const segments = wrapAnsi(logical, wrapWidth, { hard: false, trim: false }).split('\n');
      wrapped.push(...segments);
    }
  }
  const limited =
    maxLines > 0 && wrapped.length > maxLines ? wrapped.slice(wrapped.length - maxLines) : wrapped;
  const content =
    limited.length > 0
      ? limited.map((line) => colors.accent(line)).join('\n')
      : colors.muted(centerText('(no logs)', Math.max(1, width - 2))); // Keep empty state visually balanced.
  return `\n${header}\n${divider}\n${content}`;
}
