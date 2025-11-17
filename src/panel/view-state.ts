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
import { countLines } from './text-utils.js';
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

  const controlsLine = renderControlsLine(width, snapshot.paused ?? false);
  const resolvedCustomSummary =
    viewingCustomRow ?? findSummaryByMode(summaryModes, resolvedSummaryMode) ?? undefined;
  const summaryInfo = computeSummaryLines(
    snapshot,
    viewingSummary || Boolean(viewingCustomRow),
    resolvedSummaryMode,
    resolvedCustomSummary
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
    scriptBanner,
  });
  const logLimit = Math.max(0, logDisplayLimit);

  const clippedLogs = shouldShowLogs && logLimit > 0 ? logLines.slice(-logLimit) : [];

  return {
    snapshot,
    rows,
    selectedRowIndex,
    logLines: clippedLogs,
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
    countLines(headerText) +
    1 + // spacer
    countLines(targetsText) +
    countLines(globalScriptsText) +
    summaryInfo.totalLines +
    countLines(footerText);

  const remaining = height - nonLogLines;
  if (remaining <= logOverheadLines) {
    return 0;
  }
  return Math.max(0, remaining - logOverheadLines);
}

function computeSummaryLines(
  snapshot: PanelSnapshot,
  viewingSummary: boolean,
  summaryMode: string,
  customSummary?: PanelSummaryScriptResult | null
): SummaryRenderInfo {
  if (!viewingSummary) {
    return { headerLines: 0, bodyLines: 0, totalLines: 0 };
  }

  if (customSummary) {
    const body = customSummary.lines.join('\n').trim();
    const headerLines = body ? countLines(`\n${customSummary.label}:`) : 0;
    const bodyLines = body ? countLines(body) : 0;
    return { headerLines, bodyLines, totalLines: headerLines + bodyLines };
  }

  if (summaryMode === 'ai') {
    const aiSummary = formatAiSummary(snapshot.git.summary ?? []);
    if (aiSummary && aiSummary.body.trim().length > 0) {
      const headerText = aiSummary.header ?? colors.header('AI Summary of changed files:');
      const headerLines = countLines(`\n${headerText}`);
      const bodyLines = countLines(aiSummary.body.trim());
      return { headerLines, bodyLines, totalLines: headerLines + bodyLines };
    }
    // AI selected but not loaded yet: show loading placeholder centered in summary area.
    const placeholder = colors.muted('AI summary loading…');
    const lines = countLines(placeholder);
    return { headerLines: 0, bodyLines: lines, totalLines: lines };
  }

  // Fallback to git-dirty list when AI summary is empty or git view was chosen.
  const dirtyText = formatDirtyFiles(snapshot);
  const bodyLines = countLines(dirtyText);
  return { headerLines: 0, bodyLines, totalLines: bodyLines };
}
