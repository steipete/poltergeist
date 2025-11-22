import type { Logger } from '../logger.js';
import type { StatusMap, StatusObject } from '../status/types.js';
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
  countLabel?: string | number | null;
}

export interface PanelControllerOptions {
  config: PoltergeistConfig;
  projectRoot: string;
  fetchStatus: () => Promise<StatusMap>;
  startDaemon?: () => Promise<void>;
  stopDaemon?: () => Promise<void>;
  logger: Logger;
  logReader?: {
    read: (target: string, channel?: string, limit?: number) => Promise<string[]>;
  };
  scriptEventSink?: (event: ScriptEvent) => void;
  configPath?: string;
  gitPollIntervalMs?: number;
  statusPollIntervalMs?: number;
  gitSummaryMode?: 'ai' | 'list';
}

export interface ScriptEvent {
  kind: 'status' | 'summary';
  label: string;
  exitCode: number | null;
  placement?: 'summary' | 'row';
  targets?: string[];
  timestamp: number;
}
