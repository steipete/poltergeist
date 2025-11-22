import type { SummaryModeOption } from './panel-state.js';
import {
  findSummaryByMode,
  getRowSummaries,
  getSummaryLabel,
  getSummaryModes,
  hasSummaryRow,
  resolveSummaryMode,
} from './panel-state.js';
import {
  colors,
  formatAiSummary,
  formatDirtyFiles,
  formatFooter,
  formatHeader,
  formatTargets,
  renderControlsLine,
  splitStatusScripts,
} from './render-utils.js';
import { buildTargetRows, type TargetRow } from './target-tree.js';
import { countWrappedLines } from './text-utils.js';
import type { PanelSnapshot, PanelSummaryScriptResult } from './types.js';

export interface SummaryRenderInfo {
  headerLines: number;
  bodyLines: number;
  totalLines: number;
}

export interface PanelViewState {
  snapshot: PanelSnapshot;
  rows: TargetRow[];
  selectedRowIndex: number;
  logLines: string[];
  logBanner?: string;
  scriptBanner?: string;
  shouldShowLogs: boolean;
  controlsLine: string;
  width: number;
  summaryRowLabel?: string;
  summarySelected: boolean;
  summaryModes: SummaryModeOption[];
  activeSummaryKey?: string;
  customSummary?: PanelSummaryScriptResult;
  rowSummaries: PanelSummaryScriptResult[];
  summaryInfo: SummaryRenderInfo;
  logLimit: number;
  logChannel: string;
  logViewMode: 'all' | 'tests';
  summaryMode: string;
}

export interface BuildViewStateInput {
  snapshot: PanelSnapshot;
  rows?: TargetRow[];
  selectedRowIndex: number;
  logLines: string[];
  logBanner?: string;
  scriptBanner?: string;
  logViewMode: 'all' | 'tests';
  summaryMode: string;
  logChannelLabel: string;
  width: number;
  height: number;
  shouldShowLogs: boolean;
  logOverheadLines: number;
}

export const buildPanelViewState = (input: BuildViewStateInput): PanelViewState => {
  const {
    snapshot,
    rows: providedRows,
    selectedRowIndex,
    logLines,
    logBanner,
    scriptBanner,
    logViewMode,
    summaryMode,
    logChannelLabel,
    width,
    height,
    shouldShowLogs,
    logOverheadLines,
  } = input;

  const rows = providedRows ?? buildTargetRows(snapshot.targets);
  const summaryModes = getSummaryModes(snapshot);
  const resolvedSummaryMode = resolveSummaryMode(summaryModes, summaryMode);

  const summaryIndex = hasSummaryRow(snapshot) ? rows.length : null;
  const rowSummaries = getRowSummaries(snapshot);
  const customStart = rows.length + (summaryIndex !== null ? 1 : 0);
  const viewingSummary = summaryIndex !== null && selectedRowIndex === summaryIndex;
  const viewingCustomRow =
    selectedRowIndex >= customStart ? rowSummaries[selectedRowIndex - customStart] : undefined;

  const controlsLine = renderControlsLine(width, snapshot.paused ?? false, (snapshot.summary?.running ?? 0) > 0);
  const resolvedCustomSummary =
    viewingCustomRow ?? findSummaryByMode(summaryModes, resolvedSummaryMode) ?? undefined;
  const summaryInfo = computeSummaryLines(
    snapshot,
    viewingSummary || Boolean(viewingCustomRow),
    resolvedSummaryMode,
    resolvedCustomSummary,
    width
  );

  const logDisplayLimit = computeLogDisplayLimit({
    width,
    height,
    snapshot,
    summaryModes,
    summaryInfo,
    controlsLine,
    selectedRowIndex,
    summaryMode: resolvedSummaryMode,
    summaryIndex,
    rowSummaries,
    logOverheadLines,
    logBanner,
    scriptBanner,
  });
  const logLimit = Math.max(0, logDisplayLimit);

  const clippedLogs = shouldShowLogs && logLimit > 0 ? logLines.slice(-logLimit) : [];

  return {
    snapshot,
    rows,
    selectedRowIndex,
    logLines: clippedLogs,
    logBanner,
    scriptBanner,
    shouldShowLogs,
    controlsLine,
    width,
    summaryRowLabel: getSummaryLabel(summaryModes, resolvedSummaryMode),
    summarySelected: viewingSummary,
    summaryModes,
    activeSummaryKey: resolvedSummaryMode,
    customSummary: resolvedCustomSummary,
    rowSummaries,
    summaryInfo,
    logLimit,
    logChannel: logChannelLabel,
    logViewMode,
    summaryMode: resolvedSummaryMode,
  };
};

function computeLogDisplayLimit({
  width,
  height,
  snapshot,
  summaryModes,
  summaryInfo,
  controlsLine,
  selectedRowIndex,
  summaryMode,
  summaryIndex,
  rowSummaries,
  logOverheadLines,
  logBanner,
  scriptBanner,
}: {
  width: number;
  height: number;
  snapshot: PanelSnapshot;
  summaryModes: SummaryModeOption[];
  summaryInfo: SummaryRenderInfo;
  controlsLine: string;
  selectedRowIndex: number;
  summaryMode: string;
  summaryIndex: number | null;
  rowSummaries: PanelSummaryScriptResult[];
  logOverheadLines: number;
  logBanner?: string;
  scriptBanner?: string;
}): number {
  const rows = buildTargetRows(snapshot.targets);
  const headerText = formatHeader(snapshot, width);
  const summaryLabel = getSummaryLabel(summaryModes, summaryMode);
  const customStart = rows.length + (summaryIndex !== null ? 1 : 0);
  const rowSummariesWithSelection = rowSummaries.map((row, idx) => ({
    ...row,
    selected: selectedRowIndex === customStart + idx,
  }));
  const scriptsSplit = splitStatusScripts(snapshot.statusScripts ?? []);
  const targetsText = formatTargets(
    rows,
    selectedRowIndex,
    scriptsSplit.scriptsByTarget,
    width,
    summaryLabel ? { label: summaryLabel, selected: selectedRowIndex === summaryIndex } : undefined,
    rowSummariesWithSelection,
    summaryModes,
    summaryMode,
    snapshot,
    scriptsSplit.globalScripts
  );
  const globalScriptsText = scriptBanner ?? '';
  const footerText = formatFooter(controlsLine, width); // Always render as the last block.

  const nonLogLines =
    countWrappedLines(headerText, width) +
    1 + // spacer
    countWrappedLines(targetsText, width) +
    countWrappedLines(globalScriptsText, width) +
    summaryInfo.totalLines +
    countWrappedLines(footerText, width);

  const bannerLines = logBanner ? countWrappedLines(logBanner, width) : 0;

  const remaining = height - nonLogLines;
  if (remaining <= logOverheadLines + bannerLines) {
    return 0;
  }
  return Math.max(0, remaining - logOverheadLines - bannerLines);
}

function computeSummaryLines(
  snapshot: PanelSnapshot,
  viewingSummary: boolean,
  summaryMode: string,
  customSummary: PanelSummaryScriptResult | null | undefined,
  width: number
): SummaryRenderInfo {
  if (!viewingSummary) {
    return { headerLines: 0, bodyLines: 0, totalLines: 0 };
  }

  if (customSummary) {
    const body = customSummary.lines.join('\n').trim();
    const headerLines = body ? countWrappedLines(`\n${customSummary.label}:`, width) : 0;
    const bodyLines = body ? countWrappedLines(body, width) : 0;
    return { headerLines, bodyLines, totalLines: headerLines + bodyLines };
  }

  if (summaryMode === 'ai') {
    const aiSummary = formatAiSummary(snapshot.git.summary ?? []);
    if (aiSummary && aiSummary.body.trim().length > 0) {
      const headerText = aiSummary.header ?? colors.header('AI Summary of changed files:');
      const headerLines = countWrappedLines(`\n${headerText}`, width);
      const bodyLines = countWrappedLines(aiSummary.body.trim(), width);
      return { headerLines, bodyLines, totalLines: headerLines + bodyLines };
    }
    // AI selected but not loaded yet: show loading placeholder centered in summary area.
    const placeholder = colors.muted('AI summary loading…');
    const lines = countWrappedLines(placeholder, width);
    return { headerLines: 0, bodyLines: lines, totalLines: lines };
  }

  // Fallback to git-dirty list when AI summary is empty or git view was chosen.
  const dirtyText = formatDirtyFiles(snapshot);
  const bodyLines = countWrappedLines(dirtyText, width);
  return { headerLines: 0, bodyLines, totalLines: bodyLines };
}
