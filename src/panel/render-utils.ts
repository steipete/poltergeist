import { homedir } from 'node:os';
import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';
import type { SummaryModeOption } from './panel-state.js';
import type { TargetRow } from './target-tree.js';
import { centerText, pad, truncateVisible, visibleWidth } from './text-utils.js';
import type { PanelSnapshot, PanelStatusScriptResult, PanelSummaryScriptResult } from './types.js';

export const CONTROLS_LINE_RUNNING =
  'Controls: ↑/↓ move · ←/→ cycle logs · p pause · r refresh · q quit';
export const CONTROLS_LINE_PAUSED = 'Controls: ↑/↓ move · ←/→ cycle logs · r resume · q quit';

const mono = process.env.POLTERGEIST_MONOCHROME === '1';

const palette = {
  accent: '#8BE9FD',
  header: '#2EE6FF',
  text: '#F8F8F2',
  muted: '#8E95B3',
  line: '#5C6080',
  success: '#50FA7B',
  failure: '#FF5555',
  warning: '#F1FA8C',
  info: '#AEB1C2',
};

export const colors = {
  accent: (value: string) => (mono ? value : chalk.hex(palette.accent)(value)),
  header: (value: string) => (mono ? value : chalk.hex(palette.header)(value)),
  text: (value: string) => (mono ? value : chalk.hex(palette.text)(value)),
  muted: (value: string) => (mono ? value : chalk.hex(palette.muted)(value)),
  line: (value: string) => (mono ? value : chalk.hex(palette.line)(value)),
  success: (value: string) => (mono ? value : chalk.hex(palette.success)(value)),
  failure: (value: string) => (mono ? value : chalk.hex(palette.failure)(value)),
  warning: (value: string) => (mono ? value : chalk.hex(palette.warning)(value)),
  info: (value: string) => (mono ? value : chalk.hex(palette.info)(value)),
};

type HeaderMode = 'full' | 'compact' | 'narrow';

function getHeaderMode(width?: number): HeaderMode {
  if (!width) return 'full';
  if (width < 70) return 'narrow';
  if (width < 90) return 'compact';
  return 'full';
}

export function formatHeader(snapshot: PanelSnapshot, width?: number): string {
  const widthValue = Math.max(1, width ?? 80);
  const mode = getHeaderMode(widthValue);
  const branch = snapshot.git.branch ?? 'unknown';
  const dirtyFiles = snapshot.git.hasRepo ? snapshot.git.dirtyFiles : Number.NaN;
  const insertions = snapshot.git.hasRepo ? snapshot.git.insertions : Number.NaN;
  const deletions = snapshot.git.hasRepo ? snapshot.git.deletions : Number.NaN;
  const dirtyColor = !snapshot.git.hasRepo || dirtyFiles === 0 ? colors.success : colors.failure;
  const insertColor = !snapshot.git.hasRepo || insertions === 0 ? colors.info : colors.success;
  const deleteColor = !snapshot.git.hasRepo || deletions === 0 ? colors.info : colors.failure;

  const projectRoot = snapshot.projectRoot.replace(homedir(), '~');
  const projectLine = `${colors.text(snapshot.projectName)} — ${colors.muted(projectRoot)}`;
  const branchLabel = 'Branch:';
  const dirtyLabel = mode === 'full' ? 'dirty files:' : 'dirty:';
  const deltaLabel = mode === 'full' ? 'ΔLOC:' : 'Δ:';
  const separator =
    mode === 'narrow'
      ? colors.muted('·')
      : mode === 'compact'
        ? colors.muted(' · ')
        : colors.muted(' | ');
  const upstreamBadge = formatUpstreamBadge(snapshot.git, mode);
  const branchSegments = [
    `${colors.muted(branchLabel)} ${colors.text(branch)}`,
    upstreamBadge,
    `${colors.muted(dirtyLabel)} ${
      snapshot.git.hasRepo ? dirtyColor(String(dirtyFiles)) : colors.info('n/a')
    }`,
    `${colors.muted(deltaLabel)} ${
      snapshot.git.hasRepo
        ? `${insertColor(String(insertions))} / ${deleteColor(String(deletions))}`
        : colors.info('n/a')
    }`,
  ].filter(Boolean);
  const branchLine = branchSegments.join(separator);

  const summaryLine = formatSummary(snapshot, mode);
  // Order: project → branch/git → summary
  const lines = [projectLine, branchLine, summaryLine];

  const wrappedLines = lines.flatMap((line) =>
    wrapAnsi(line, widthValue - 2, {
      hard: false,
      trim: false,
    }).split('\n')
  );
  const horizontal = colors.line('─'.repeat(Math.max(2, widthValue - 2)));
  const top = colors.line(`┌${horizontal}┐`);
  const bottom = colors.line(`└${horizontal}┘`);
  const framed = wrappedLines
    .map((line) => {
      const centered = centerText(line, widthValue - 2);
      const padded = pad(centered, widthValue - 2);
      return `${colors.line('│')}${padded}${colors.line('│')}`;
    })
    .join('\n');
  return [top, framed, bottom].join('\n');
}

function formatSummary(snapshot: PanelSnapshot, mode: HeaderMode = 'full'): string {
  if (snapshot.paused) {
    return colors.warning('Auto-builds paused — press r to resume or run `poltergeist resume`');
  }

  const daemonLabel = snapshot.summary.running === 1 ? 'daemon' : 'daemons';
  const daemonSuffix =
    mode === 'full' && snapshot.summary.running > 0
      ? formatDaemonSuffix(snapshot.summary.activeDaemons ?? [])
      : '';

  const targetFailures = snapshot.summary.targetFailures ?? snapshot.summary.failures ?? 0;
  const scriptFailures = snapshot.summary.scriptFailures ?? 0;
  const failureParts: string[] = [];
  if (targetFailures > 0) {
    failureParts.push(`${targetFailures} build${targetFailures === 1 ? '' : 's'} failed`);
  }
  if (scriptFailures > 0) {
    failureParts.push(`${scriptFailures} script${scriptFailures === 1 ? '' : 's'} failed`);
  }
  const failureText =
    failureParts.length === 0
      ? colors.success('0 failed')
      : colors.failure(failureParts.join(' + '));

  const daemonText = `${snapshot.summary.running}/${snapshot.summary.totalTargets} ${daemonLabel}`;
  const buildingText =
    snapshot.summary.building > 0
      ? colors.warning(`${snapshot.summary.building} building`)
      : undefined;

  if (mode === 'narrow') {
    const parts = [buildingText, failureText, daemonText].filter(Boolean);
    return parts.join(' · ');
  }

  const parts = [buildingText, failureText, daemonText].filter(Boolean);
  const summary = parts.join(' · ');
  return `${summary}${daemonSuffix ? ` ${daemonSuffix}` : ''}`;
}

function formatUpstreamBadge(git: PanelSnapshot['git'], mode: HeaderMode): string | undefined {
  const ahead = git.ahead ?? 0;
  const behind = git.behind ?? 0;
  if (ahead === 0 && behind === 0) {
    return mode === 'narrow' ? undefined : colors.success('✓ up to date');
  }
  const parts: string[] = [];
  if (behind > 0) {
    parts.push(colors.failure(`↓${behind}`));
  }
  if (ahead > 0) {
    parts.push(colors.accent(`↑${ahead}`));
  }
  const label = mode === 'full' ? 'upstream' : 'up';
  return `${colors.muted(label)} ${parts.join(' ')}`.trim();
}

export function renderControlsLine(width: number, paused: boolean): string {
  const base =
    width < 60
      ? paused
        ? '↑/↓ move · ←/→ cycle · p pause · r resume · q quit'
        : '↑/↓ move · ←/→ cycle · p pause · r refresh · q quit'
      : paused
        ? CONTROLS_LINE_PAUSED
        : CONTROLS_LINE_RUNNING;
  const trimmed = base.length > width ? base.slice(0, Math.max(0, width)) : base;
  return trimmed; // Centering happens in formatFooter so we keep the raw text here.
}

export function formatFooter(controlsLine: string, width: number): string {
  const divider = colors.line('─'.repeat(Math.max(4, width)));
  const centered = centerText(controlsLine, width);
  return `${divider}\n${colors.header(centered)}`;
}

export function formatTargets(
  rows: TargetRow[],
  selectedIndex: number,
  scriptsByTarget: Map<string, PanelStatusScriptResult[]>,
  width: number,
  summaryRow?: { label: string; selected: boolean },
  rowSummaries: Array<PanelSummaryScriptResult & { selected?: boolean }> = [],
  summaryModes: SummaryModeOption[] = [],
  activeSummaryKey?: string,
  snapshot?: PanelSnapshot,
  globalScripts: PanelStatusScriptResult[] = []
): string {
  if (rows.length === 0) {
    return `${colors.header('No targets configured.')}\n${colors.muted('Hint: run poltergeist status to populate targets')}`;
  }

  // Dynamically size columns so narrow terminals stay readable.
  const targetCol = Math.max(18, Math.min(36, Math.floor(width * 0.5)));
  const statusCol = Math.max(16, width - targetCol);

  const lines: string[] = [];
  const headerLine = `${pad(colors.header('Target'), targetCol)}${pad(colors.header('Status'), statusCol)}`;
  const divider = colors.line('─'.repeat(Math.max(4, width)));
  lines.push(headerLine);
  lines.push(divider);

  rows.forEach((rowEntry, index) => {
    const entry = rowEntry.target;
    const status = entry.status.lastBuild?.status || entry.status.status || 'unknown';
    const { color, label } = statusColor(status);
    const pending = entry.status.pendingFiles ?? 0;
    const scripts = scriptsByTarget.get(entry.name) ?? [];
    const hasFailure = scripts.some((script) => (script.exitCode ?? 0) > 0);
    const hasUnknown = !hasFailure && scripts.some((script) => script.exitCode === null);
    const prefixDepth = Math.max(0, rowEntry.depth - 1);
    const connector =
      rowEntry.depth === 0
        ? ''
        : rowEntry.connector === 'last' || rowEntry.connector === 'single'
          ? '└─ '
          : '├─ ';
    const indent = rowEntry.depth > 0 ? '  '.repeat(prefixDepth) : '';
    const scriptBadge = hasFailure
      ? colors.failure(' ✖ script')
      : hasUnknown
        ? colors.warning(' ⚠ script')
        : '';
    const rawName = `${indent}${connector}${entry.name}${scriptBadge}`;
    const displayName = truncateVisible(rawName, targetCol);
    const targetName = index === selectedIndex ? colors.accent(displayName) : displayName;
    const enabledLabel = entry.enabled ? '' : colors.header(' (disabled)');
    const statusLabel = pending > 0 ? `${label} · +${pending} queued` : label;
    const lastBuild = formatRelativeTime(entry.status.lastBuild?.timestamp);
    const duration = formatDuration(entry.status.lastBuild?.duration);

    const badge = formatStatusBadge(status, statusLabel, color);
    const timePart = lastBuild && lastBuild !== '—' ? color(lastBuild) : '';
    const durationPart = duration && duration !== '—' ? colors.muted(duration) : '';
    const progressText =
      status === 'building' && entry.status.lastBuild?.progress
        ? formatProgress(entry.status.lastBuild.progress, statusCol)
        : null;
    const statusDetails =
      progressText ?? formatStatusDetails(statusCol, badge, timePart, durationPart);

    const rowLine = `${pad(`${targetName}${enabledLabel}`, targetCol)}${pad(statusDetails, statusCol)}`;
    lines.push(rowLine);

    const scriptLines =
      scriptsByTarget
        .get(entry.name)
        ?.flatMap((script) => formatScriptLines(script, '  ', width)) ?? [];
    lines.push(...scriptLines);

    entry.status.postBuild?.forEach((result) => {
      const postColor = postBuildColor(result.status);
      const durationTag =
        result.durationMs !== undefined ? ` · ${formatDurationShort(result.durationMs)}` : '';
      const hint = result.status === 'failure' ? failureHint(result.lines ?? []) : undefined;
      const summaryText =
        result.summary || `${result.name}: ${result.status ?? 'pending'}`.replace(/\s+/g, ' ');
      const enrichedSummary = hint ? `${summaryText} — ${hint}` : summaryText;
      const postLines = wrapAnsi(
        postColor(`  ${enrichedSummary}${durationTag}`),
        Math.max(1, width),
        {
          hard: false,
          trim: false,
        }
      ).split('\n');
      for (const line of postLines) {
        lines.push(line);
      }
      // Compact success: skip detailed lines when the post-build succeeded.
      if (result.status !== 'success') {
        result.lines?.forEach((line) => {
          const wrapped = wrapAnsi(postColor(`    ${line}`), Math.max(1, width), {
            hard: false,
            trim: false,
          }).split('\n');
          for (const wrappedLine of wrapped) {
            lines.push(wrappedLine);
          }
        });
      }
    });
  });

  rowSummaries.forEach((row) => {
    const name = row.selected ? colors.accent(row.label) : row.label;
    const status =
      row.exitCode && row.exitCode !== 0 ? colors.failure('needs attention') : colors.muted('view');
    lines.push(`${pad(name, targetCol)}${pad(status, statusCol)}`);
  });

  if (globalScripts.length > 0) {
    globalScripts.forEach((script) => {
      const isFail = (script.exitCode ?? 0) !== 0;
      const name = colors.muted(script.label);
      const primaryLine = script.lines?.[0]?.trim() || (isFail ? 'failed' : 'ok');
      const statusText = isFail ? colors.failure(primaryLine) : colors.muted(primaryLine);
      lines.push(`${pad(name, targetCol)}${pad(statusText, statusCol)}`);
    });
  }

  lines.push(divider);

  if (summaryRow && summaryModes.length > 0 && snapshot) {
    const chips = formatSummaryChips(summaryModes, activeSummaryKey, width, snapshot, {
      center: true,
    });
    if (chips) {
      lines.push(chips);
    }
  }

  return lines.join('\n');
}

export function formatSummaryChips(
  modes: SummaryModeOption[],
  activeSummaryKey: string | undefined,
  width: number,
  snapshot: PanelSnapshot,
  options: { center?: boolean } = {}
): string {
  const center = options.center ?? true;
  if (modes.length === 0) return '';

  const parts = modes.map((mode) => {
    const count = summaryCount(mode, snapshot);
    const suffix = count > 0 ? ` (${count})` : '';
    const label = mode.type === 'ai' ? 'AI Summary' : mode.label;
    const body = `${label}${suffix}`;
    return mode.key === activeSummaryKey ? colors.accent(body) : colors.muted(body);
  });

  const line = parts.join(' | ');
  return center ? centerText(line, width) : line;
}

function summaryCount(mode: SummaryModeOption, snapshot: PanelSnapshot): number {
  if (mode.type === 'ai') {
    return (snapshot.git.summary ?? []).filter((line) => line.trim().length > 0).length;
  }
  if (mode.type === 'git') {
    return snapshot.git.dirtyFileNames?.length ?? snapshot.git.dirtyFiles ?? 0;
  }
  if (mode.summary?.lines) {
    return mode.summary.lines.filter((line) => line.trim().length > 0).length;
  }
  return 0;
}

function formatDaemonSuffix(activeDaemons: string[]): string {
  if (!activeDaemons.length) {
    return '';
  }
  const formatted = activeDaemons.map((daemon) => {
    if (daemon.startsWith('target:')) {
      return daemon.replace('target:', '');
    }
    if (/^\d+$/.test(daemon)) {
      return `PID ${daemon}`;
    }
    return daemon;
  });
  return ` (${formatted.join(', ')})`;
}

export function formatGlobalScripts(scripts: PanelStatusScriptResult[], width: number): string {
  if (scripts.length === 0) {
    return '';
  }
  const lines = scripts.flatMap((script) => formatScriptLines(script, '', width));
  const divider = colors.line('─'.repeat(Math.max(4, width)));
  const header = `${divider}\n${colors.header('Global scripts:')}`;
  return `\n${header}\n${lines.join('\n')}`;
}

export function formatDirtyFiles(snapshot: PanelSnapshot): string {
  const dirtyFiles = snapshot.git.dirtyFileNames ?? [];
  const totalDirty = snapshot.git.dirtyFiles ?? dirtyFiles.length;
  if (totalDirty === 0 && dirtyFiles.length === 0) {
    return '';
  }
  const groups = groupDirtyFiles(dirtyFiles);
  const visibleCount = Math.min(dirtyFiles.length, 10);
  const lines: string[] = [];
  lines.push(
    colors.header(
      `Dirty Files (${visibleCount}${totalDirty > visibleCount ? ` of ${totalDirty}` : ''}):`
    )
  );
  groups.forEach((group) => {
    const dir = group.dir || '.';
    const label =
      group.files.length === 1
        ? dir === '.'
          ? group.files[0]
          : `${dir}/${group.files[0]}`
        : `${dir}: ${group.files.join(', ')}`;
    lines.push(colors.muted(`• ${label}`));
  });
  const remaining = totalDirty - visibleCount;
  if (remaining > 0) {
    lines.push(colors.muted(`…and ${remaining} more`));
  } else if (visibleCount === 0 && totalDirty > 0) {
    lines.push(colors.muted(`• (${totalDirty} dirty file(s); paths unavailable)`));
  }
  return `\n${lines.join('\n')}`;
}

export function formatAiSummary(lines: string[]): { header?: string; body: string } | null {
  const filtered = lines.filter((line) => line.trim().length > 0);
  if (filtered.length === 0) {
    return null;
  }
  const first = filtered[0];
  const match = first.match(/^(?![-*+])([^:]{3,80}):\s*(.*)$/);
  if (match) {
    const header = colors.header(`${match[1].trim()}:`);
    const remainder = match[2].trim();
    if (remainder.length > 0) {
      filtered[0] = remainder;
    } else {
      filtered.shift();
    }
    return { header, body: filtered.join('\n') };
  }
  return { body: filtered.join('\n') };
}

function statusColor(status?: string): { color: (value: string) => string; label: string } {
  switch (status) {
    case 'success':
      return { color: colors.success, label: 'success' };
    case 'failure':
      return { color: colors.failure, label: 'failed' };
    case 'building':
      return { color: colors.warning, label: 'building' };
    case 'watching':
      return { color: colors.accent, label: 'watching' };
    default:
      return { color: colors.info, label: status || 'unknown' };
  }
}

function formatStatusDetails(
  maxWidth: number,
  badge: string,
  timePart: string,
  durationPart: string
): string {
  const join = (parts: string[]) => parts.filter(Boolean).join(' ');
  const candidates: string[][] = [];

  const full = [badge, timePart, durationPart].filter(Boolean);
  if (full.length) {
    candidates.push(full);
  }

  const withoutDuration = [badge, timePart].filter(Boolean);
  if (durationPart && withoutDuration.length) {
    candidates.push(withoutDuration);
  }

  if (withoutDuration.length > 0 || full.length > 0) {
    candidates.push([badge]);
  }

  for (const parts of candidates) {
    const joined = join(parts);
    if (visibleWidth(joined) <= maxWidth) {
      return joined;
    }
  }

  return truncateVisible(badge, maxWidth);
}

export function formatProgress(
  progress: import('../types.js').BuildProgress,
  maxWidth: number
): string | null {
  let { percent, current, total, label } = progress;
  if (!Number.isFinite(percent) || percent >= 100 || percent < 0) return null;
  // Round for display so the width math stays predictable.
  percent = Math.max(0, Math.min(99, Math.round(percent)));
  const percentText = `${percent}%`;
  const countText = Number.isFinite(current) && Number.isFinite(total) ? `${current}/${total}` : '';
  const labelText = label ? ` ${label}` : '';

  // Reserve space for fixed parts; whatever remains is the bar width.
  const reserved =
    percentText.length +
    (countText ? 1 + countText.length : 0) + // space + count
    (labelText ? labelText.length : 0) +
    4; // spaces + brackets
  const barWidth = Math.max(4, Math.min(24, maxWidth - reserved));
  const bar = progressBar(percent, barWidth);
  const parts = [percentText, bar];
  if (countText) parts.push(countText);
  if (labelText) parts.push(labelText.trim());
  const text = parts.join(' ');
  // Avoid truncating mid-ANSI: if it won't fit, drop the label first, then count.
  if (visibleWidth(text) > maxWidth) {
    const noLabel = parts.slice(0, labelText ? -1 : parts.length).join(' ');
    if (visibleWidth(noLabel) <= maxWidth) return noLabel;
    if (countText) {
      const stripped = [percentText, bar].join(' ');
      return visibleWidth(stripped) <= maxWidth ? stripped : percentText;
    }
  }
  return text;
}

export function progressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const clamped = Math.max(0, Math.min(width, filled));
  const empty = Math.max(0, width - clamped);
  // Prefer CLI-style blocks; fall back to ASCII if the terminal/font mangles them.
  const preferAscii = process.env.POLTERGEIST_ASCII_BAR === '1';
  const filledChar = preferAscii ? '=' : '█';
  const emptyChar = preferAscii ? '-' : '░';
  const bodyRaw = colors.accent(filledChar.repeat(clamped)) + colors.muted(emptyChar.repeat(empty));
  const bar = colors.muted('[') + bodyRaw + colors.muted(']');

  // Auto-fallback: if the rendered width loses glyphs, retry with ASCII.
  if (!preferAscii && visibleWidth(stripAnsiCodes(bar)) !== visibleWidth(bar)) {
    const asciiBody = colors.accent('='.repeat(clamped)) + colors.muted('-'.repeat(empty));
    return colors.muted('[') + asciiBody + colors.muted(']');
  }

  return bar;
}

function formatStatusBadge(
  status: string | undefined,
  label: string,
  color: (value: string) => string
): string {
  switch (status) {
    case 'success':
      return colors.success('✔');
    case 'failure':
      return colors.failure('✗ failure');
    case 'building':
      return colors.warning('⧗ building');
    case 'watching':
      return colors.accent('◉ watching');
    default:
      return color(label);
  }
}

function formatRelativeTime(timestamp?: string): string {
  if (!timestamp) return '—';
  const delta = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.max(0, Math.floor(delta / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(durationMs?: number | null): string {
  if (!durationMs) return '—';
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 1000);
  return `${seconds}s`;
}

function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function scriptColorFromExitCode(exitCode?: number | null): (value: string) => string {
  if (!exitCode || exitCode <= 0) {
    return colors.success;
  }
  return colors.failure;
}

function postBuildColor(status?: string): (value: string) => string {
  switch (status) {
    case 'success':
      return colors.success;
    case 'failure':
      return colors.failure;
    case 'running':
      return colors.warning;
    default:
      return colors.info;
  }
}

function failureHint(lines: string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = stripAnsiCodes(lines[i]).trim();
    if (!raw) continue;
    const exitMatch = raw.match(/exit code\s+(\d+)/i);
    if (exitMatch) return `exit ${exitMatch[1]}`;
    if (raw.length <= 80) return raw;
    return truncateVisible(raw, 80);
  }
  return undefined;
}

function groupDirtyFiles(files: string[]): Array<{ dir: string; files: string[] }> {
  const limit = files.slice(0, 10);
  const groups = new Map<string, string[]>();
  for (const path of limit) {
    const lastSlash = path.lastIndexOf('/');
    const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
    const existing = groups.get(dir) ?? [];
    existing.push(fileName);
    groups.set(dir, existing);
  }
  return Array.from(groups.entries()).map(([dir, groupFiles]) => ({
    dir,
    files: groupFiles,
  }));
}

export function splitStatusScripts(scripts: PanelStatusScriptResult[]): {
  scriptsByTarget: Map<string, PanelStatusScriptResult[]>;
  globalScripts: PanelStatusScriptResult[];
} {
  const scriptsByTarget = new Map<string, PanelStatusScriptResult[]>();
  const globalScripts: PanelStatusScriptResult[] = [];
  scripts.forEach((script) => {
    if (script.targets?.length) {
      script.targets.forEach((target) => {
        const existing = scriptsByTarget.get(target) ?? [];
        scriptsByTarget.set(target, [...existing, script]);
      });
    } else {
      globalScripts.push(script);
    }
  });
  return { scriptsByTarget, globalScripts };
}

export function formatScriptLines(
  script: PanelStatusScriptResult,
  prefix = '',
  width = 80
): string[] {
  const scriptColor = scriptColorFromExitCode(script.exitCode);
  const looksLikeSwiftLint = isSwiftLint(script.label, script.lines[0]);
  const limit = Math.max(
    1,
    Math.min(
      looksLikeSwiftLint ? 3 : Number.POSITIVE_INFINITY,
      script.maxLines ?? script.lines.length
    )
  );
  const selectedLines = script.lines.slice(0, limit).map(stripAnsiCodes);
  const normalizedLines = selectedLines.map((line, index) =>
    normalizeScriptLine(line, script.label, script.exitCode, index === 0)
  );
  const hideLabelForSwiftLintSuccess = normalizedLines[0] === 'SwiftLint ✓';
  const hideLabel =
    (script.targets?.length === 1 &&
      script.label.toLowerCase().startsWith('tests') &&
      script.lines.length > 0) ||
    script.label.toLowerCase() === 'tests' ||
    hideLabelForSwiftLintSuccess;

  if (normalizedLines.length === 0) {
    const line = `${scriptColor(`${prefix}${hideLabel ? '' : `${script.label}: `}(no output)`)}`;
    return wrapAnsi(line, Math.max(1, width), {
      hard: false,
      trim: false,
    }).split('\n');
  }
  const block = normalizedLines
    .map((line, index) =>
      index === 0
        ? `${scriptColor(`${prefix}${hideLabel ? '' : `${script.label}: `}${line}`)}`
        : `${scriptColor(`${prefix}  ${line}`)}`
    )
    .join('\n');
  return wrapAnsi(block, Math.max(1, width), { hard: false, trim: false }).split('\n');
}

const ansiRegexPattern = '\\x1B\\[[0-?]*[ -/]*[@-~]';
const ansiRegex = new RegExp(ansiRegexPattern, 'g');
export function stripAnsiCodes(value: string): string {
  return value.replace(ansiRegex, '');
}

function normalizeScriptLine(
  line: string,
  label: string,
  exitCode: number | null,
  isFirstLine: boolean
): string {
  const looksLikeSwiftLint = isSwiftLint(label, line);

  if (looksLikeSwiftLint && isFirstLine && (exitCode ?? 0) === 0) {
    const zeroMatch = /swiftlint:\s*0\s+errors\s*\/\s*0\s+warnings/i;
    if (zeroMatch.test(line)) {
      return 'SwiftLint ✓';
    }
  }

  return line;
}

function isSwiftLint(label: string, line?: string): boolean {
  const lowerLabel = label.toLowerCase();
  const lowerLine = line?.toLowerCase() ?? '';
  return (
    lowerLabel.includes('swiftlint') ||
    lowerLine.startsWith('swiftlint') ||
    lowerLine.includes('swiftlint:')
  );
}
