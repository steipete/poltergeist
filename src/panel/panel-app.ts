import { appendFileSync } from 'node:fs';
import {
  type Component,
  Container,
  Markdown,
  ProcessTerminal,
  Spacer,
  Text,
  TUI,
} from '@mariozechner/pi-tui';
import wrapAnsi from 'wrap-ansi';

import type { Logger } from '../logger.js';
import { cycleChannelIndex, DEFAULT_LOG_CHANNEL } from '../utils/log-channels.js';
import { filterBuildLogs, filterTestLogs, formatLogs, LOG_OVERHEAD_LINES } from './log-utils.js';
import type { StatusPanelController } from './panel-controller.js';
import {
  getDefaultSummaryMode,
  getRowSummaries,
  getSummaryModes,
  hasSummaryRow,
  resolveSummaryMode,
  getLogChannels as stateLogChannels,
  getSelectedChannel as stateSelectedChannel,
  syncLogChannelState,
} from './panel-state.js';
import {
  colors,
  formatAiSummary,
  formatDirtyFiles,
  formatFooter,
  formatHeader,
  formatTargets,
  splitStatusScripts,
} from './render-utils.js';
import { buildTargetRows, type TargetRow } from './target-tree.js';
import { limitSummaryLines } from './text-utils.js';
import type { PanelSnapshot, TargetPanelEntry } from './types.js';
import { buildPanelViewState, type PanelViewState } from './view-state.js';

const LOG_FETCH_LIMIT = 40;
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
  private logBackoff?: NodeJS.Timeout;
  private lastActiveLogPoll = 0;
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
  // Persist last manually selected summary mode when navigating.
  private lastManualSummaryMode: string | null = null;
  // Cache flattened rows per snapshot to avoid redundant tree builds.
  private cachedRowsVersion: number | null = null;
  private cachedRows: TargetRow[] = [];
  private unsubscribeLogs?: () => void;
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
    this.summaryMode = getDefaultSummaryMode(this.snapshot);
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
    this.unsubscribeLogs = this.controller.onLogUpdate(() => {
      this.queueLogRefresh();
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
    if (this.unsubscribeLogs) {
      this.unsubscribeLogs();
      this.unsubscribeLogs = undefined;
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
    const ordered = this.getRows();
    const totalRows = ordered.length + (hasSummaryRow(next) ? 1 : 0) + getRowSummaries(next).length;
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
    const resolved = resolveSummaryMode(getSummaryModes(this.snapshot), this.summaryMode);
    this.summaryMode = this.lastManualSummaryMode ?? resolved;
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
      if (lower === 'p') {
        void this.controller.pause();
        i += 1;
        continue;
      }
      if (lower === 'r') {
        if (this.snapshot.paused) {
          void this.controller.resume();
        } else {
          void this.controller.forceRefresh();
        }
        i += 1;
        continue;
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
    const ordered = this.getRows();
    const totalRows =
      ordered.length +
      (hasSummaryRow(this.snapshot) ? 1 : 0) +
      getRowSummaries(this.snapshot).length;
    const maxIndex = Math.max(0, totalRows - 1);
    if (maxIndex === 0 && this.selectedRowIndex === 0) {
      return;
    }
    // Remember that the user moved manually so auto-selection (preferredIndex) won't override them.
    this.userNavigated = true;
    const nextIndex = Math.min(Math.max(this.selectedRowIndex + delta, 0), maxIndex);
    if (nextIndex === this.selectedRowIndex) {
      return;
    }
    this.selectedRowIndex = nextIndex;
    this.logViewMode = 'all';
    this.logChannelLabel = this.getSelectedChannel(ordered[this.selectedRowIndex]?.target);
    this.updateView('selection');
    this.queueLogRefresh();
    this.updateLogPolling();
  }

  private shouldShowLogs(_entry?: TargetPanelEntry): boolean {
    // Always show the log section; tests benefit and idle targets show an explicit "(no logs)" message.
    return true;
  }

  private syncLogChannelState(targets: TargetPanelEntry[]): void {
    const next = syncLogChannelState(targets, this.logChannelIndex);
    this.logChannelIndex.clear();
    for (const [key, value] of next.entries()) {
      this.logChannelIndex.set(key, value);
    }
  }

  private getLogChannels(target: TargetPanelEntry | undefined): string[] {
    return stateLogChannels(target);
  }

  private getSelectedChannel(target: TargetPanelEntry | undefined): string {
    return stateSelectedChannel(this.logChannelIndex, target);
  }

  private getCurrentRowTarget(): TargetPanelEntry | undefined {
    const rows = this.getRows();
    if (this.selectedRowIndex < 0 || this.selectedRowIndex >= rows.length) {
      return undefined;
    }
    return rows[this.selectedRowIndex]?.target;
  }

  private getRows(): TargetRow[] {
    const version = this.snapshot.lastUpdated ?? Number.NaN;
    if (this.cachedRowsVersion === version) {
      return this.cachedRows;
    }
    const rows = buildTargetRows(this.snapshot.targets);
    this.cachedRowsVersion = version;
    this.cachedRows = rows;
    return rows;
  }

  private updateView(_reason: string = 'update'): void {
    const width = this.terminal.columns || 80;
    const height = this.terminal.rows || 24;
    const entry = this.getCurrentRowTarget();
    const shouldShowLogs = Boolean(entry && this.shouldShowLogs(entry));
    const rows = this.getRows();

    const viewState = buildPanelViewState({
      snapshot: this.snapshot,
      rows,
      selectedRowIndex: this.selectedRowIndex,
      logLines: this.logLines,
      logViewMode: this.logViewMode,
      summaryMode: this.summaryMode,
      logChannelLabel: this.logChannelLabel,
      width,
      height,
      shouldShowLogs,
      logOverheadLines: LOG_OVERHEAD_LINES,
    });

    this.summaryMode = viewState.summaryMode;
    this.view.update(viewState);
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
      this.lastActiveLogPoll = Date.now();
      if (this.logBackoff) {
        clearTimeout(this.logBackoff);
        this.logBackoff = undefined;
      }
      this.logTimer = setInterval(() => {
        this.queueLogRefresh();
      }, 1000);
      return;
    }
    if (!active && this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = undefined;
    }
    if (!active && !this.logTimer && !this.logBackoff) {
      const sinceActive = Date.now() - this.lastActiveLogPoll;
      const delay = sinceActive < 5000 ? 5000 : 0;
      if (delay > 0) {
        this.logBackoff = setTimeout(() => {
          this.logBackoff = undefined;
          this.queueLogRefresh();
        }, delay);
      }
    }
  }

  private flipLogModeOrSummary(direction: 'next' | 'prev'): void {
    const rows = buildTargetRows(this.snapshot.targets);
    const summaryIndex = hasSummaryRow(this.snapshot) ? rows.length : null;
    const viewingSummary = summaryIndex !== null && this.selectedRowIndex === summaryIndex;
    if (viewingSummary) {
      const modes = getSummaryModes(this.snapshot);
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
      this.lastManualSummaryMode = this.summaryMode;
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
        rowSummaries,
        state.summaryModes,
        state.summarySelected ? state.activeSummaryKey : undefined,
        snapshot,
        globalScripts
      )
    );
    this.globalScripts.setText('');
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
    this.footer.setText(formatFooter(state.controlsLine, state.width));
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
