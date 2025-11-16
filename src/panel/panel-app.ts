import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  type Component,
  Container,
  Markdown,
  ProcessTerminal,
  Spacer,
  Text,
  TUI,
  visibleWidth,
} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';
import type { Logger } from '../logger.js';
import {
  cycleChannelIndex,
  DEFAULT_LOG_CHANNEL,
  normalizeLogChannels,
} from '../utils/log-channels.js';
import type { StatusPanelController } from './panel-controller.js';
import { buildTargetRows, type TargetRow } from './target-tree.js';
import type {
  PanelSnapshot,
  PanelStatusScriptResult,
  PanelSummaryScriptResult,
  TargetPanelEntry,
} from './types.js';

const CONTROLS_LINE = 'Controls: ↑/↓ move · ←/→ cycle logs · r refresh · q quit';
const LOG_FETCH_LIMIT = 40;
const LOG_OVERHEAD_LINES = 3; // blank spacer + header + divider inside formatLogs
const SUMMARY_FRACTION = 0.5; // summary gets half of remaining lines when selected

interface PanelAppOptions {
  controller: StatusPanelController;
  logger: Logger;
}

export class PanelApp {
  private readonly controller: StatusPanelController;
  private readonly logger: Logger;
  private readonly terminal = new ProcessTerminal();
  private readonly tui = new TUI(this.terminal);
  private readonly inputBridge = new InputBridge((input) => {
    this.handleInput(input);
  });
  private readonly view = new PanelView();
  private readonly debugInput = process.env.POLTERGEIST_INPUT_DEBUG === '1';
  private exitPromise?: Promise<void>;
  private exitResolver?: () => void;
  private unsubscribe?: () => void;
  private logTimer?: NodeJS.Timeout;
  private pendingLogRefresh?: Promise<void>;
  private disposed = false;
  private started = false;
  private resizeListenerAttached = false;
  private userNavigated = false;
  // Left/right cycles through available log channels for the selected target.
  private readonly logChannelIndex = new Map<string, number>();
  // If only a single channel exists, left/right toggles between all/test-filtered logs.
  private logViewMode: 'all' | 'tests' = 'all';
  // Left/right while on summary toggles AI vs Git summary.
  private summaryMode: string = 'ai';
  private snapshot: PanelSnapshot;
  // Index within the flattened target list (tree order); may point to summary/custom rows.
  private selectedRowIndex: number;
  private logLines: string[] = [];
  private logChannelLabel: string = DEFAULT_LOG_CHANNEL;
  private readonly handleTerminalResize = () => {
    if (!this.disposed) {
      this.updateView('resize');
    }
  };

  constructor(options: PanelAppOptions) {
    this.controller = options.controller;
    this.logger = options.logger;
    this.snapshot = this.controller.getSnapshot();
    const initialRows = buildTargetRows(this.snapshot.targets);
    if (this.snapshot.preferredIndex !== undefined && initialRows.length > 0) {
      const preferredTarget = this.snapshot.targets[this.snapshot.preferredIndex];
      const preferredName = preferredTarget?.name;
      const preferredIdx =
        preferredName !== undefined
          ? initialRows.findIndex((t) => t.target.name === preferredName)
          : -1;
      this.selectedRowIndex = preferredIdx >= 0 ? preferredIdx : 0;
    } else {
      this.selectedRowIndex = initialRows.length > 0 ? 0 : 0;
    }
    this.summaryMode = this.getDefaultSummaryMode(this.snapshot);
    this.syncLogChannelState(this.snapshot.targets);
    this.logChannelLabel = this.getSelectedChannel(initialRows[this.selectedRowIndex]?.target);

    this.tui.addChild(this.view);
    // Input bridge never renders anything but receives all keyboard input.
    this.tui.addChild(this.inputBridge);
    this.tui.setFocus(this.inputBridge);
  }

  public start(): Promise<void> {
    if (this.exitPromise) {
      return this.exitPromise;
    }

    this.exitPromise = new Promise((resolve) => {
      this.exitResolver = resolve;
    });

    this.updateView('init');

    this.unsubscribe = this.controller.onUpdate((snapshot) => {
      this.handleSnapshot(snapshot);
    });

    this.tui.start();
    this.started = true;
    this.tui.requestRender();
    if (typeof process.stdout.on === 'function') {
      process.stdout.on('resize', this.handleTerminalResize);
      this.resizeListenerAttached = true;
    }
    this.queueLogRefresh();
    this.updateLogPolling();

    return this.exitPromise;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    if (this.resizeListenerAttached && typeof process.stdout.off === 'function') {
      process.stdout.off('resize', this.handleTerminalResize);
      this.resizeListenerAttached = false;
    }
    if (this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = undefined;
    }
    this.pendingLogRefresh = undefined;
    this.tui.stop();
    if (this.exitResolver) {
      this.exitResolver();
      this.exitResolver = undefined;
    }
  }

  private handleSnapshot(next: PanelSnapshot): void {
    this.snapshot = next;
    this.syncLogChannelState(next.targets);
    const ordered = buildTargetRows(next.targets);
    const totalRows =
      ordered.length + (this.hasSummaryRow(next) ? 1 : 0) + this.getRowSummaries(next).length;
    const maxIndex = Math.max(0, totalRows - 1);
    if (!this.userNavigated) {
      if (next.preferredIndex !== undefined && next.targets.length > 0) {
        const preferred = next.targets[next.preferredIndex];
        const preferredIdx = ordered.findIndex((t) => t.target.name === preferred?.name);
        this.selectedRowIndex =
          preferredIdx >= 0 ? preferredIdx : Math.min(this.selectedRowIndex, maxIndex);
      } else {
        this.selectedRowIndex = Math.min(this.selectedRowIndex, maxIndex);
      }
    } else if (this.selectedRowIndex > maxIndex) {
      this.selectedRowIndex = maxIndex;
    }
    const selectedEntry = ordered[this.selectedRowIndex]?.target;
    this.logChannelLabel = this.getSelectedChannel(selectedEntry);
    this.summaryMode = this.resolveSummaryMode(
      this.getSummaryModes(this.snapshot),
      this.summaryMode
    );
    this.updateView('snapshot');
    this.queueLogRefresh();
    this.updateLogPolling();
  }

  private handleInput(input: string): void {
    if (this.disposed || !input) return;

    if (this.debugInput) {
      const bytesHex = [...Buffer.from(input)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ');
      appendFileSync(
        '/tmp/poltergeist-panel-input.log',
        `[PanelInputDebug] ${new Date().toISOString()} bytes=${bytesHex} text=${JSON.stringify(input)}\n`
      );
    }

    // Byte-by-byte handling (mirrors working pitui loop).
    for (let i = 0; i < input.length; ) {
      const char = input[i];

      const lower = char.toLowerCase();
      if (lower === 'q') {
        if (this.debugInput) {
          appendFileSync('/tmp/poltergeist-panel-input.log', '[PanelInputDebug] exit via q\n');
        }
        this.dispose();
        return;
      }
      if (lower === 'r') {
        void this.controller.forceRefresh();
      }
      if (lower === 'b') {
        this.setLogViewMode('all');
        i += 1;
        continue;
      }
      if (lower === 't') {
        this.setLogViewMode('tests');
        i += 1;
        continue;
      }
      if (char === '\u0003') {
        if (this.debugInput) {
          appendFileSync('/tmp/poltergeist-panel-input.log', '[PanelInputDebug] exit via Ctrl+C\n');
        }
        this.dispose();
        return;
      }
      if (char === '\x1b' && input[i + 1] === '[') {
        const code = input[i + 2];
        if (code === 'A') {
          this.moveSelection(-1);
          i += 3;
          continue;
        }
        if (code === 'B') {
          this.moveSelection(1);
          i += 3;
          continue;
        }
        if (code === 'C') {
          this.flipLogModeOrSummary('next');
          i += 3;
          continue;
        }
        if (code === 'D') {
          this.flipLogModeOrSummary('prev');
          i += 3;
          continue;
        }
      }

      i += 1;
    }
  }

  private setLogViewMode(mode: 'all' | 'tests'): void {
    if (this.logViewMode === mode) return;
    this.logViewMode = mode;
    this.updateView('log-view-mode-key');
    this.queueLogRefresh();
    this.updateLogPolling();
  }

  private moveSelection(delta: number): void {
    const ordered = buildTargetRows(this.snapshot.targets);
    const totalRows =
      ordered.length +
      (this.hasSummaryRow(this.snapshot) ? 1 : 0) +
      this.getRowSummaries(this.snapshot).length;
    const maxIndex = Math.max(0, totalRows - 1);
    if (maxIndex === 0 && this.selectedRowIndex === 0) {
      return;
    }
    this.userNavigated = true;
    const nextIndex = Math.min(Math.max(this.selectedRowIndex + delta, 0), maxIndex);
    if (nextIndex === this.selectedRowIndex) {
      return;
    }
    this.selectedRowIndex = nextIndex;
    this.logViewMode = 'all';
    this.summaryMode = this.getDefaultSummaryMode(this.snapshot);
    this.logChannelLabel = this.getSelectedChannel(ordered[this.selectedRowIndex]);
    this.updateView('selection');
    this.queueLogRefresh();
    this.updateLogPolling();
  }

  private shouldShowLogs(_entry?: TargetPanelEntry): boolean {
    // Always show the log section; tests benefit and idle targets show an explicit "(no logs)" message.
    return true;
  }

  private syncLogChannelState(targets: TargetPanelEntry[]): void {
    const activeNames = new Set<string>();
    for (const target of targets) {
      activeNames.add(target.name);
      const channels = this.getLogChannels(target);
      const currentIndex = this.logChannelIndex.get(target.name) ?? 0;
      const clampedIndex = Math.min(Math.max(currentIndex, 0), Math.max(0, channels.length - 1));
      this.logChannelIndex.set(target.name, clampedIndex);
    }
    // Drop entries for targets no longer present.
    for (const name of Array.from(this.logChannelIndex.keys())) {
      if (!activeNames.has(name)) {
        this.logChannelIndex.delete(name);
      }
    }
  }

  private getLogChannels(target: TargetPanelEntry | undefined): string[] {
    if (!target) return [DEFAULT_LOG_CHANNEL];
    return normalizeLogChannels(target.logChannels);
  }

  private getSelectedChannel(target: TargetPanelEntry | undefined): string {
    const channels = this.getLogChannels(target);
    if (channels.length === 0) return DEFAULT_LOG_CHANNEL;
    const index = this.logChannelIndex.get(target?.name ?? '') ?? 0;
    return channels[Math.min(Math.max(index, 0), channels.length - 1)];
  }

  private getCurrentRowTarget(): TargetPanelEntry | undefined {
    const rows = buildTargetRows(this.snapshot.targets);
    if (this.selectedRowIndex < 0 || this.selectedRowIndex >= rows.length) {
      return undefined;
    }
    return rows[this.selectedRowIndex]?.target;
  }

  private updateView(_reason: string = 'update'): void {
    const rows = buildTargetRows(this.snapshot.targets);
    const summaryModes = this.getSummaryModes(this.snapshot);
    this.summaryMode = this.resolveSummaryMode(summaryModes, this.summaryMode);

    const summaryIndex = this.hasSummaryRow(this.snapshot) ? rows.length : null;
    const rowSummaries = this.getRowSummaries(this.snapshot);
    const customStart = rows.length + (summaryIndex !== null ? 1 : 0);
    const viewingSummary = summaryIndex !== null && this.selectedRowIndex === summaryIndex;
    const viewingCustomRow =
      this.selectedRowIndex >= customStart
        ? rowSummaries[this.selectedRowIndex - customStart]
        : undefined;
    const entry =
      !viewingSummary && !viewingCustomRow && this.selectedRowIndex < rows.length
        ? rows[this.selectedRowIndex]?.target
        : undefined;
    const shouldShowLogs = entry ? this.shouldShowLogs(entry) : false;
    const width = this.terminal.columns || 80;
    const height = this.terminal.rows || 24;
    const controlsLine = renderControlsLine(width);
    const summaryInfo = this.computeSummaryLines(
      this.snapshot,
      viewingSummary || Boolean(viewingCustomRow),
      this.summaryMode,
      viewingCustomRow ?? this.findSummaryByMode(summaryModes, this.summaryMode)
    );
    const logDisplayLimit = this.computeLogDisplayLimit({
      width,
      height,
      snapshot: this.snapshot,
      summaryInfo,
      controlsLine,
    });
    const logLimit = Math.max(0, logDisplayLimit);
    this.view.update({
      snapshot: this.snapshot,
      rows,
      selectedRowIndex: this.selectedRowIndex,
      logLines: shouldShowLogs && logLimit > 0 ? this.logLines.slice(-logLimit) : [],
      shouldShowLogs,
      controlsLine,
      width,
      summaryRowLabel: this.getSummaryLabel(summaryModes, this.summaryMode),
      summarySelected: viewingSummary,
      customSummary: viewingCustomRow ?? this.findSummaryByMode(summaryModes, this.summaryMode),
      rowSummaries,
      summaryInfo,
      logLimit,
      logChannel: this.logChannelLabel,
      logViewMode: this.logViewMode,
      summaryMode: this.summaryMode,
    });
    if (this.started) {
      this.tui.requestRender();
    }
  }

  private queueLogRefresh(): void {
    if (this.pendingLogRefresh) {
      return;
    }
    this.pendingLogRefresh = (async () => {
      try {
        await this.refreshLogs();
      } finally {
        this.pendingLogRefresh = undefined;
      }
    })();
  }

  private async refreshLogs(): Promise<void> {
    const entry = this.getCurrentRowTarget();
    if (!entry || !this.shouldShowLogs(entry)) {
      this.logLines = [];
      this.logChannelLabel = DEFAULT_LOG_CHANNEL;
      this.updateView('logs-reset');
      return;
    }
    try {
      const channel = this.getSelectedChannel(entry);
      const lines = await this.controller.getLogLines(entry.name, channel, LOG_FETCH_LIMIT);
      this.logChannelLabel = channel;
      this.logLines = this.logViewMode === 'tests' ? filterTestLogs(lines) : lines;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logLines = [`Failed to read log: ${message}`];
      this.logChannelLabel = DEFAULT_LOG_CHANNEL;
      this.logger.warn(`[Panel] Failed to read logs for ${entry.name}: ${message}`);
    }
    this.updateView('logs');
  }

  private updateLogPolling(): void {
    const entry = this.getCurrentRowTarget();
    const active =
      entry?.status.lastBuild?.status === 'building' || entry?.status.status === 'building';
    if (active && !this.logTimer) {
      this.logTimer = setInterval(() => {
        this.queueLogRefresh();
      }, 1000);
      return;
    }
    if (!active && this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = undefined;
    }
  }

  private computeLogDisplayLimit({
    width,
    height,
    snapshot,
    summaryInfo,
    controlsLine,
  }: {
    width: number;
    height: number;
    snapshot: PanelSnapshot;
    summaryInfo: SummaryRenderInfo;
    controlsLine: string;
  }): number {
    const rows = buildTargetRows(snapshot.targets);
    const headerText = formatHeader(snapshot, width);
    const summaryLabel = this.getSummaryLabel(this.getSummaryModes(snapshot), this.summaryMode);
    const summaryIndex = this.hasSummaryRow(snapshot) ? rows.length : null;
    const customStart = rows.length + (summaryIndex !== null ? 1 : 0);
    const rowSummaries = this.getRowSummaries(snapshot).map((row, idx) => ({
      ...row,
      selected: this.selectedRowIndex === customStart + idx,
    }));
    const scriptsSplit = splitStatusScripts(snapshot.statusScripts ?? []);
    const targetsText = formatTargets(
      rows,
      this.selectedRowIndex,
      scriptsSplit.scriptsByTarget,
      width,
      summaryLabel
        ? { label: summaryLabel, selected: this.selectedRowIndex === summaryIndex }
        : undefined,
      rowSummaries
    );
    const globalScriptsText = formatGlobalScripts(scriptsSplit.globalScripts, width);
    const footerText = (() => {
      const divider = colors.line('─'.repeat(Math.max(4, width)));
      return `${divider}\n${colors.header(controlsLine)}`;
    })();

    const nonLogLines =
      countLines(headerText) +
      1 + // spacer
      countLines(targetsText) +
      countLines(globalScriptsText) +
      summaryInfo.totalLines +
      countLines(footerText);

    const remaining = height - nonLogLines;
    if (remaining <= LOG_OVERHEAD_LINES) {
      return 0;
    }
    return Math.max(0, remaining - LOG_OVERHEAD_LINES);
  }

  private computeSummaryLines(
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
    }

    const dirtyText = formatDirtyFiles(snapshot);
    const bodyLines = countLines(dirtyText);
    return { headerLines: 0, bodyLines, totalLines: bodyLines };
  }

  private getSummaryModes(snapshot: PanelSnapshot): SummaryModeOption[] {
    const modes: SummaryModeOption[] = [];
    if (this.hasAiSummary(snapshot)) {
      modes.push({ key: 'ai', label: 'Summary (AI)', type: 'ai' });
    }
    if (this.hasDirtySummary(snapshot)) {
      modes.push({ key: 'git', label: 'Summary (Git)', type: 'git' });
    }
    for (const summary of this.getSummarySummaries(snapshot)) {
      modes.push({
        key: `custom:${summary.label}`,
        label: `Summary (${summary.label})`,
        type: 'custom',
        summary,
      });
    }
    return modes;
  }

  private getRowSummaries(snapshot: PanelSnapshot): PanelSummaryScriptResult[] {
    return (snapshot.summaryScripts ?? []).filter((summary) => summary.placement === 'row');
  }

  private getSummarySummaries(snapshot: PanelSnapshot): PanelSummaryScriptResult[] {
    return (snapshot.summaryScripts ?? []).filter((summary) => summary.placement === 'summary');
  }

  private getDefaultSummaryMode(snapshot: PanelSnapshot): string {
    const modes = this.getSummaryModes(snapshot);
    return modes[0]?.key ?? 'ai';
  }

  private findSummaryByMode(
    modes: SummaryModeOption[],
    key: string
  ): PanelSummaryScriptResult | null {
    const match = modes.find((mode) => mode.key === key && mode.type === 'custom');
    return match?.summary ?? null;
  }

  private getSummaryLabel(modes: SummaryModeOption[], mode: string): string | undefined {
    return modes.find((m) => m.key === mode)?.label ?? modes[0]?.label;
  }

  private flipLogModeOrSummary(direction: 'next' | 'prev'): void {
    const rows = buildTargetRows(this.snapshot.targets);
    const summaryIndex = this.hasSummaryRow(this.snapshot) ? rows.length : null;
    const viewingSummary = summaryIndex !== null && this.selectedRowIndex === summaryIndex;
    if (viewingSummary) {
      const modes = this.getSummaryModes(this.snapshot);
      if (modes.length === 0) {
        return;
      }
      const currentIdx = modes.findIndex((mode) => mode.key === this.summaryMode);
      const safeIdx = currentIdx === -1 ? 0 : currentIdx;
      const nextIdx =
        direction === 'next'
          ? (safeIdx + 1) % modes.length
          : (safeIdx - 1 + modes.length) % modes.length;
      this.summaryMode = modes[nextIdx]?.key ?? modes[0].key;
      this.updateView('summary-mode');
      return;
    }

    // Toggle logs when not on summary.
    const entry = this.getCurrentRowTarget();
    if (!entry || !this.shouldShowLogs(entry)) {
      return;
    }

    const channels = this.getLogChannels(entry);
    if (channels.length > 1) {
      const currentIdx = this.logChannelIndex.get(entry.name) ?? 0;
      const nextIdx = cycleChannelIndex(channels, currentIdx, direction);
      this.logChannelIndex.set(entry.name, nextIdx);
      this.logChannelLabel = channels[nextIdx];
      this.updateView('log-channel');
    } else {
      // Single channel: keep legacy build/test filtering behaviour for users that expect it.
      const nextView = this.logViewMode === 'all' ? 'tests' : 'all';
      this.logViewMode = nextView;
      this.updateView('log-view-mode');
    }
    this.queueLogRefresh();
    this.updateLogPolling();
  }

  private hasAiSummary(snapshot: PanelSnapshot): boolean {
    return (snapshot.git.summary ?? []).some((line) => line.trim().length > 0);
  }

  private hasDirtySummary(snapshot: PanelSnapshot): boolean {
    const dirtyCount = snapshot.git.dirtyFiles ?? 0;
    const names = snapshot.git.dirtyFileNames ?? [];
    return dirtyCount > 0 || names.length > 0;
  }

  private resolveSummaryMode(modes: SummaryModeOption[], desired: string): string {
    if (modes.length === 0) {
      return desired;
    }
    return modes.find((mode) => mode.key === desired)?.key ?? modes[0].key;
  }

  private hasSummaryRow(snapshot: PanelSnapshot): boolean {
    return this.getSummaryModes(snapshot).length > 0;
  }
}

interface PanelViewState {
  snapshot: PanelSnapshot;
  rows: TargetRow[];
  selectedRowIndex: number;
  logLines: string[];
  shouldShowLogs: boolean;
  controlsLine: string;
  width: number;
  summaryRowLabel?: string;
  summarySelected: boolean;
  customSummary?: PanelSummaryScriptResult;
  rowSummaries: PanelSummaryScriptResult[];
  summaryInfo: SummaryRenderInfo;
  logLimit: number;
  logChannel: string;
  logViewMode: 'all' | 'tests';
  summaryMode: string;
}

interface SummaryRenderInfo {
  headerLines: number;
  bodyLines: number;
  totalLines: number;
}

interface SummaryModeOption {
  key: string;
  label: string;
  type: 'ai' | 'git' | 'custom';
  summary?: PanelSummaryScriptResult;
}

class PanelView extends Container {
  private readonly header = new Text('', 0, 0);
  private readonly targets = new Text('', 0, 0);
  private readonly globalScripts = new Text('', 0, 0);
  private readonly dirtyFiles = new Text('', 0, 0);
  private readonly aiHeader = new Text('', 0, 0);
  private readonly aiMarkdown = createWordWrappedMarkdown();
  private readonly logs = new Text('', 0, 0);
  private readonly footer = new Text('', 0, 0);
  private readonly spacer = new Spacer(1);

  constructor() {
    super();
    this.addChild(this.header);
    this.addChild(this.spacer);
    this.addChild(this.targets);
    this.addChild(this.globalScripts);
    this.addChild(this.dirtyFiles);
    this.addChild(this.aiHeader);
    this.addChild(this.aiMarkdown);
    this.addChild(this.logs);
    this.addChild(this.footer);
  }

  public update(state: PanelViewState): void {
    const { snapshot } = state;
    const { scriptsByTarget, globalScripts } = splitStatusScripts(snapshot.statusScripts ?? []);
    const summaryIndex = state.summaryRowLabel ? state.rows.length : null;
    const rowStart = summaryIndex !== null ? summaryIndex + 1 : state.rows.length;
    const rowSummaries = state.rowSummaries.map((row, idx) => ({
      ...row,
      selected: state.selectedRowIndex === rowStart + idx,
    }));
    this.header.setText(formatHeader(snapshot, state.width));
    this.targets.setText(
      formatTargets(
        state.rows,
        state.selectedRowIndex,
        scriptsByTarget,
        state.width,
        state.summaryRowLabel
          ? { label: state.summaryRowLabel, selected: state.summarySelected }
          : undefined,
        rowSummaries
      )
    );
    this.globalScripts.setText(formatGlobalScripts(globalScripts, state.width));
    const showSummary = state.summarySelected || Boolean(state.customSummary);
    if (showSummary) {
      const summaryDivider = colors.line('─'.repeat(Math.max(4, state.width)));
      if (state.customSummary) {
        const headerText = colors.header(`\n${state.customSummary.label}:`);
        this.aiHeader.setText(`${headerText}\n${summaryDivider}`);
        const body = state.customSummary.lines.join('\n').trim();
        const limitedBody = limitSummaryLines(
          body || colors.muted('No output'),
          Math.max(1, Math.floor(state.logLimit * SUMMARY_FRACTION))
        );
        this.dirtyFiles.setText('');
        this.aiMarkdown.setText(limitedBody);
      } else if (state.summaryMode === 'ai') {
        const aiSummary = formatAiSummary(snapshot.git.summary ?? []);
        if (aiSummary && aiSummary.body.trim().length > 0) {
          this.dirtyFiles.setText('');
          const headerText = aiSummary.header ?? colors.header('AI Summary of changed files:');
          this.aiHeader.setText(`\n${headerText}\n${summaryDivider}`);
          const limitedBody = limitSummaryLines(
            aiSummary.body.trim(),
            Math.max(1, Math.floor(state.logLimit * SUMMARY_FRACTION))
          );
          this.aiMarkdown.setText(limitedBody);
        } else {
          const limitedDirty = limitSummaryLines(
            formatDirtyFiles(snapshot),
            Math.max(1, Math.floor(state.logLimit * SUMMARY_FRACTION))
          );
          this.dirtyFiles.setText(limitedDirty);
          this.aiHeader.setText('');
          this.aiMarkdown.setText('');
        }
      } else {
        const limitedDirty = limitSummaryLines(
          formatDirtyFiles(snapshot),
          Math.max(1, Math.floor(state.logLimit * SUMMARY_FRACTION))
        );
        const dirtyBody = limitedDirty.trim().length > 0 ? limitedDirty : colors.muted('Git clean');
        const divider = colors.line('─'.repeat(Math.max(4, state.width)));
        this.aiHeader.setText(`${colors.header('\nGit dirty files:')}\n${divider}`);
        this.dirtyFiles.setText(`${dirtyBody}\n${summaryDivider}`);
        this.aiMarkdown.setText('');
      }
    } else {
      this.dirtyFiles.setText('');
      this.aiHeader.setText('');
      this.aiMarkdown.setText('');
    }
    if (state.shouldShowLogs) {
      const entry = state.rows[state.selectedRowIndex]?.target;
      const filteredLogs =
        state.logViewMode === 'tests'
          ? filterTestLogs(state.logLines)
          : filterBuildLogs(state.logLines);
      this.logs.setText(
        formatLogs(
          entry,
          state.logChannel,
          filteredLogs,
          state.width,
          state.logLimit,
          state.logViewMode
        )
      );
    } else {
      this.logs.setText('');
    }
    const divider = colors.line('─'.repeat(Math.max(4, state.width)));
    this.footer.setText(`${divider}\n${colors.header(state.controlsLine)}`);
  }
}

function createWordWrappedMarkdown(): Markdown {
  const markdown = new Markdown('');
  enableMarkdownWordWrap(markdown);
  return markdown;
}

function enableMarkdownWordWrap(markdown: Markdown): void {
  // TODO: Upstream a proper word-wrapping option to @mariozechner/pi-tui's Markdown component.

  const patchTarget = markdown as unknown as {
    wrapLine?: (line: string, width: number) => string[];
    wrapSingleLine?: (line: string, width: number) => string[];
  };

  // Override both wrap helpers with wrap-ansi so we get word-aware wrapping even for colored lines.
  const wrap = (line: string, width: number): string[] => {
    if (line === undefined || line === null) {
      return [''];
    }
    const segments = line.split('\n');
    const result: string[] = [];
    for (const segment of segments) {
      if (segment === '') {
        result.push('');
        continue;
      }
      const wrapped = wrapAnsi(segment, Math.max(1, width), {
        hard: false,
        trim: false,
      });
      result.push(...wrapped.split('\n'));
    }
    return result.length > 0 ? result : [''];
  };
  patchTarget.wrapLine = wrap;
  patchTarget.wrapSingleLine = wrap;
}

class InputBridge implements Component {
  constructor(private readonly handler: (input: string) => void) {}

  render(): string[] {
    return [];
  }

  handleInput(data: string): void {
    this.handler(data);
  }
}

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

const colors = {
  accent: (value: string) => chalk.hex(palette.accent)(value),
  header: (value: string) => chalk.hex(palette.header)(value),
  text: (value: string) => chalk.hex(palette.text)(value),
  muted: (value: string) => chalk.hex(palette.muted)(value),
  line: (value: string) => chalk.hex(palette.line)(value),
  success: (value: string) => chalk.hex(palette.success)(value),
  failure: (value: string) => chalk.hex(palette.failure)(value),
  warning: (value: string) => chalk.hex(palette.warning)(value),
  info: (value: string) => chalk.hex(palette.info)(value),
};

type HeaderMode = 'full' | 'compact' | 'narrow';

function getHeaderMode(width?: number): HeaderMode {
  if (!width) return 'full';
  if (width < 70) return 'narrow';
  if (width < 90) return 'compact';
  return 'full';
}

function formatHeader(snapshot: PanelSnapshot, width?: number): string {
  const mode = getHeaderMode(width);
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
        ? `${insertColor(`+${insertions}`)} ${colors.muted('/')} ${deleteColor(`-${deletions}`)}`
        : colors.info('n/a')
    }`,
  ].filter(Boolean);
  const spacer = mode === 'narrow' ? colors.muted(' ') : '  ';
  const branchLine = branchSegments.join(spacer + separator + spacer);

  const summaryLine = formatSummary(snapshot, mode);

  const lines = [projectLine, branchLine, summaryLine];
  const targetContentWidth = width ? Math.max(2, width - 2) : undefined;
  const mapped = lines.map((line) => centerText(line, targetContentWidth));
  return boxLines(mapped, width);
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

function formatSummary(snapshot: PanelSnapshot, mode: HeaderMode = 'full'): string {
  const daemonLabel = snapshot.summary.running === 1 ? 'daemon' : 'daemons';
  const daemonSuffix =
    mode === 'full' && snapshot.summary.running > 0
      ? formatDaemonSuffix(snapshot.summary.activeDaemons ?? [])
      : '';
  const buildingText =
    snapshot.summary.building > 0
      ? colors.warning(`${snapshot.summary.building} building`)
      : `${snapshot.summary.building} building`;

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

  const daemonText = `${snapshot.summary.running}/${snapshot.summary.totalTargets} ${daemonLabel}${
    snapshot.summary.running === 1 ? '' : 's'
  }`;

  if (mode === 'narrow') {
    return `${buildingText} · ${failureText} · ${daemonText}`;
  }

  return `${buildingText} · ${failureText} · ${daemonText}${daemonSuffix ? ` ${daemonSuffix}` : ''}`;
}

function pad(text: string, width: number): string {
  const length = visibleWidth(text);
  if (length >= width) {
    return text;
  }
  return `${text}${' '.repeat(width - length)}`;
}

function renderControlsLine(width: number): string {
  // Drop the leading label on narrow terminals to save space.
  if (width < 60) {
    return '↑/↓ move · ←/→ cycle · r refresh · q quit';
  }
  return CONTROLS_LINE;
}

function centerText(text: string, width?: number): string {
  if (!width) return text;
  const length = visibleWidth(text);
  if (length >= width) {
    return text;
  }
  const totalPad = width - length;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
}

function boxLines(lines: string[], maxWidth?: number): string {
  if (lines.length === 0) return '';
  const widestLine = Math.max(...lines.map((line) => visibleWidth(line)));
  const boxWidth = maxWidth ? Math.max(4, maxWidth) : Math.max(4, widestLine + 2);
  const contentWidth = boxWidth - 2;
  const top = `┌${'─'.repeat(contentWidth)}┐`;
  const bottom = `└${'─'.repeat(contentWidth)}┘`;
  const body = lines.map((line) => `│${pad(line, contentWidth)}│`);
  return [top, ...body, bottom].join('\n');
}

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split('\n').length;
}

function limitSummaryLines(text: string, maxLines: number): string {
  if (maxLines <= 0) return '';
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n');
}

const TEST_LOG_PATTERN = /\b(test(ing)?|tests|suite|spec|describe|it|passed|failed)\b/i;

export function filterTestLogs(lines: string[]): string[] {
  const filtered = lines.filter((line) => TEST_LOG_PATTERN.test(line));
  return filtered.length > 0 ? filtered : lines;
}

export function filterBuildLogs(lines: string[]): string[] {
  const filtered = lines.filter((line) => !TEST_LOG_PATTERN.test(line));
  return filtered.length > 0 ? filtered : lines;
}

function formatTargets(
  rows: TargetRow[],
  selectedIndex: number,
  scriptsByTarget: Map<string, PanelStatusScriptResult[]>,
  width: number,
  summaryRow?: { label: string; selected: boolean },
  rowSummaries: Array<PanelSummaryScriptResult & { selected?: boolean }> = []
): string {
  if (rows.length === 0) {
    return colors.header('No targets configured.');
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
    const prefixDepth = Math.max(0, rowEntry.depth - 1);
    const connector =
      rowEntry.depth === 0
        ? ''
        : rowEntry.connector === 'last' || rowEntry.connector === 'single'
          ? '└─ '
          : '├─ ';
    const indent = rowEntry.depth > 0 ? '  '.repeat(prefixDepth) : '';
    const displayName = `${indent}${connector}${entry.name}`;
    const targetName = index === selectedIndex ? colors.accent(displayName) : displayName;
    const enabledLabel = entry.enabled ? '' : colors.header(' (disabled)');
    const statusLabel = pending > 0 ? `${label} · +${pending} queued` : label;
    const lastBuild = formatRelativeTime(entry.status.lastBuild?.timestamp);
    const duration = formatDuration(entry.status.lastBuild?.duration);

    const badge = formatStatusBadge(status, statusLabel, color);
    const timePart = lastBuild && lastBuild !== '—' ? color(lastBuild) : '';
    const durationPart = duration && duration !== '—' ? colors.muted(duration) : '';

    let statusDetails = badge;
    if (timePart) {
      statusDetails += ` ${timePart}`;
    }
    if (durationPart) {
      statusDetails += ` · ${durationPart}`;
    }

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
      const summaryText =
        result.summary || `${result.name}: ${result.status ?? 'pending'}`.replace(/\s+/g, ' ');
      const postLines = wrapAnsi(postColor(`  ${summaryText}${durationTag}`), Math.max(1, width), {
        hard: false,
        trim: false,
      }).split('\n');
      for (const line of postLines) {
        lines.push(line);
      }
      result.lines?.forEach((line) => {
        const wrapped = wrapAnsi(postColor(`    ${line}`), Math.max(1, width), {
          hard: false,
          trim: false,
        }).split('\n');
        for (const wrappedLine of wrapped) {
          lines.push(wrappedLine);
        }
      });
    });
  });

  if (summaryRow) {
    const summaryName = summaryRow.selected ? colors.accent(summaryRow.label) : summaryRow.label;
    const summaryStatus = colors.muted('view');
    lines.push(`${pad(summaryName, targetCol)}${pad(summaryStatus, statusCol)}`);
  }

  rowSummaries.forEach((row) => {
    const name = row.selected ? colors.accent(row.label) : row.label;
    const status =
      row.exitCode && row.exitCode !== 0 ? colors.failure('needs attention') : colors.muted('view');
    lines.push(`${pad(name, targetCol)}${pad(status, statusCol)}`);
  });

  lines.push(divider);

  return lines.join('\n');
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

function formatGlobalScripts(scripts: PanelStatusScriptResult[], width: number): string {
  if (scripts.length === 0) {
    return '';
  }
  const lines = scripts.flatMap((script) => formatScriptLines(script, '', width));
  return `\n${lines.join('\n')}`;
}

function formatDirtyFiles(snapshot: PanelSnapshot): string {
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

function formatAiSummary(lines: string[]): { header?: string; body: string } | null {
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

export function formatLogs(
  entry: TargetPanelEntry | undefined,
  channel: string,
  lines: string[],
  width: number,
  maxLines: number,
  viewMode: 'all' | 'tests'
): string {
  if (!entry) {
    return '';
  }
  const header = colors.header(
    `Logs — ${entry.name}${
      entry.status.lastBuild?.status ? ` (${entry.status.lastBuild.status})` : ''
    } · ${channel}${viewMode === 'tests' ? ' [tests]' : ''}`
  );
  const divider = colors.line('─'.repeat(Math.max(4, width)));
  const wrapped: string[] = [];
  const wrapWidth = Math.max(1, width - 2);
  for (const line of lines) {
    const segments = wrapAnsi(line, wrapWidth, { hard: false, trim: false }).split('\n');
    wrapped.push(...segments);
  }
  const limited =
    maxLines > 0 && wrapped.length > maxLines ? wrapped.slice(wrapped.length - maxLines) : wrapped;
  const content =
    limited.length > 0
      ? limited.map((line) => colors.accent(line)).join('\n')
      : colors.muted(centerText('(no logs)', Math.max(1, width - 2)));
  return `\n${header}\n${divider}\n${content}`;
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

function splitStatusScripts(scripts: PanelStatusScriptResult[]): {
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

function formatScriptLines(script: PanelStatusScriptResult, prefix = '', width = 80): string[] {
  const scriptColor = scriptColorFromExitCode(script.exitCode);
  const limit = Math.max(1, script.maxLines ?? script.lines.length);
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
function stripAnsiCodes(value: string): string {
  return value.replace(ansiRegex, '');
}

function normalizeScriptLine(
  line: string,
  label: string,
  exitCode: number | null,
  isFirstLine: boolean
): string {
  const lowerLine = line.toLowerCase();
  const lowerLabel = label.toLowerCase();
  const looksLikeSwiftLint =
    lowerLabel.includes('swiftlint') ||
    lowerLine.startsWith('swiftlint') ||
    lowerLine.includes('swiftlint:');

  if (looksLikeSwiftLint && isFirstLine && (exitCode ?? 0) === 0) {
    const zeroMatch = /swiftlint:\s*0\s+errors\s*\/\s*0\s+warnings/i;
    if (zeroMatch.test(line)) {
      return 'SwiftLint ✓';
    }
  }

  return line;
}
