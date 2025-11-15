import type { Logger } from '../logger.js';
import type { StatusObject } from '../status/types.js';
import type { PoltergeistConfig } from '../types.js';
import type { GitMetrics } from './git-metrics.js';

export interface TargetPanelEntry {
  name: string;
  status: StatusObject;
  targetType?: string;
  enabled?: boolean;
}

export interface PanelSummary {
  totalTargets: number;
  building: number;
  failures: number;
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

export interface PanelControllerOptions {
  config: PoltergeistConfig;
  projectRoot: string;
  fetchStatus: () => Promise<Record<string, unknown>>;
  logger: Logger;
  gitPollIntervalMs?: number;
  statusPollIntervalMs?: number;
  gitSummaryMode?: 'ai' | 'list';
}
