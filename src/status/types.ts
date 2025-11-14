export interface StatusObject {
  status?: string;
  pid?: number; // Legacy format
  process?: {
    pid: number;
    hostname: string;
    isActive: boolean;
    lastHeartbeat?: string;
    startTime?: string;
  };
  lastBuild?: {
    timestamp: string;
    status: string;
    duration?: number;
    exitCode?: number;
    errorSummary?: string;
    gitHash?: string;
    builder?: string;
    error?: string;
  };
  app?: {
    bundleId?: string;
    runningPid?: number;
  };
  appInfo?: {
    bundleId?: string;
    outputPath?: string;
    iconPath?: string;
  };
  pendingFiles?: number;
  buildCommand?: string;
  buildStats?: {
    averageDuration: number;
    minDuration?: number;
    maxDuration?: number;
    successfulBuilds?: Array<{ duration: number; timestamp: string }>;
  };
  enabled?: boolean;
  type?: string;
}

export type StatusMap = Record<string, unknown>;
