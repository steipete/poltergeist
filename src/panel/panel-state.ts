import { DEFAULT_LOG_CHANNEL, normalizeLogChannels } from '../utils/log-channels.js';
import type { PanelSnapshot, PanelSummaryScriptResult, TargetPanelEntry } from './types.js';

export interface SummaryModeOption {
  key: string;
  label: string;
  type: 'ai' | 'git' | 'custom';
  summary?: PanelSummaryScriptResult;
  hasData: boolean;
}

export const getLogChannels = (target: TargetPanelEntry | undefined): string[] => {
  if (!target) return [DEFAULT_LOG_CHANNEL];
  return normalizeLogChannels(target.logChannels);
};

/**
 * Reconcile the current log-channel index map with the active targets.
 * Returns a fresh map so callers can treat it immutably.
 */
export const syncLogChannelState = (
  targets: TargetPanelEntry[],
  previous: Map<string, number>
): Map<string, number> => {
  const next = new Map<string, number>();
  for (const target of targets) {
    const channels = getLogChannels(target);
    const currentIndex = previous.get(target.name) ?? 0;
    const clamped = Math.min(Math.max(currentIndex, 0), Math.max(0, channels.length - 1));
    next.set(target.name, clamped);
  }
  return next;
};

export const getSelectedChannel = (
  logChannelIndex: Map<string, number>,
  target: TargetPanelEntry | undefined
): string => {
  const channels = getLogChannels(target);
  if (channels.length === 0) return DEFAULT_LOG_CHANNEL;
  const index = logChannelIndex.get(target?.name ?? '') ?? 0;
  return channels[Math.min(Math.max(index, 0), channels.length - 1)];
};

export const getSummaryModes = (snapshot: PanelSnapshot): SummaryModeOption[] => {
  const modes: SummaryModeOption[] = [];
  if (hasAiSummary(snapshot)) {
    modes.push({ key: 'ai', label: 'AI', type: 'ai', hasData: true });
  } else {
    modes.push({ key: 'ai', label: 'AI', type: 'ai', hasData: false });
  }
  if (hasDirtySummary(snapshot)) {
    modes.push({ key: 'git', label: 'Git', type: 'git', hasData: true });
  } else {
    modes.push({ key: 'git', label: 'Git', type: 'git', hasData: false });
  }
  for (const summary of getSummarySummaries(snapshot)) {
    modes.push({
      key: `custom:${summary.label}`,
      label: summary.label ?? 'Custom',
      type: 'custom',
      summary,
      hasData:
        (summary.lines ?? []).some((line) => line.trim().length > 0) ||
        (summary.exitCode ?? 0) !== 0,
    });
  }
  return modes;
};

export const getSummaryLabel = (modes: SummaryModeOption[], mode: string): string | undefined =>
  modes.find((m) => m.key === mode)?.label ?? modes[0]?.label;

export const resolveSummaryMode = (modes: SummaryModeOption[], desired: string): string => {
  if (modes.length === 0) {
    return desired;
  }
  return modes.find((mode) => mode.key === desired)?.key ?? modes[0].key;
};

export const getDefaultSummaryMode = (snapshot: PanelSnapshot): string => {
  const modes = getSummaryModes(snapshot);
  const withData = modes.find((mode) => mode.hasData);
  return withData?.key ?? modes[0]?.key ?? 'ai';
};

export const findSummaryByMode = (
  modes: SummaryModeOption[],
  key: string
): PanelSummaryScriptResult | null => {
  const match = modes.find((mode) => mode.key === key && mode.type === 'custom');
  return match?.summary ?? null;
};

export const hasSummaryRow = (snapshot: PanelSnapshot): boolean =>
  getSummaryModes(snapshot).some((mode) => mode.hasData);

export const getRowSummaries = (snapshot: PanelSnapshot): PanelSummaryScriptResult[] =>
  (snapshot.summaryScripts ?? []).filter((summary) => summary.placement === 'row');

export const getSummarySummaries = (snapshot: PanelSnapshot): PanelSummaryScriptResult[] =>
  (snapshot.summaryScripts ?? []).filter((summary) => summary.placement === 'summary');

const hasAiSummary = (snapshot: PanelSnapshot): boolean =>
  (snapshot.git.summary ?? []).some((line) => line.trim().length > 0);

const hasDirtySummary = (snapshot: PanelSnapshot): boolean => {
  const dirtyCount = snapshot.git.dirtyFiles ?? 0;
  const names = snapshot.git.dirtyFileNames ?? [];
  return dirtyCount > 0 || names.length > 0;
};
