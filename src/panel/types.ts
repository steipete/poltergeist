import type { Logger } from '../logger.js';
import type { StatusObject } from '../status/types.js';
import type { PoltergeistConfig } from '../types.js';
import type { GitMetrics } from './git-metrics.js';

export interface TargetPanelEntry {
  name: string;
  status: StatusObject;
  targetType?: string;
  enabled?: boolean;
  logChannels?: string[];
  group?: string;
}

export interface PanelSummary {
  totalTargets: number;
  building: number;
  failures: number;
  /** Number of failed build targets (excludes status scripts) */
  targetFailures?: number;
  /** Number of failed status scripts */
  scriptFailures?: number;
  running: number;
  activeDaemons?: string[];
}

export interface PanelSnapshot {
  targets: TargetPanelEntry[];
  summary: PanelSummary;
  git: GitMetrics;
  projectName: string;
  projectRoot: string;
  preferredIndex: number;
  lastUpdated: number;
  statusScripts?: PanelStatusScriptResult[];
  summaryScripts?: PanelSummaryScriptResult[];
  paused?: boolean;
}

export interface PanelStatusScriptResult {
  label: string;
  lines: string[];
  targets?: string[];
  lastRun: number;
  exitCode: number | null;
  durationMs: number;
  maxLines?: number;
}

export interface PanelSummaryScriptResult {
  label: string;
  lines: string[];
  lastRun: number;
  exitCode: number | null;
  durationMs: number;
  placement: 'summary' | 'row';
  maxLines?: number;
  formatter?: 'auto' | 'none' | 'swift' | 'ts';
}

export interface PanelControllerOptions {
  config: PoltergeistConfig;
  projectRoot: string;
  fetchStatus: () => Promise<Record<string, unknown>>;
  logger: Logger;
  configPath?: string;
  gitPollIntervalMs?: number;
  statusPollIntervalMs?: number;
  gitSummaryMode?: 'ai' | 'list';
}
