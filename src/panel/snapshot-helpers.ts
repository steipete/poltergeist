import type { PanelSummary, TargetPanelEntry } from './types.js';

export function computeSummary(
  targets: TargetPanelEntry[],
  options?: { scriptFailures?: number }
): PanelSummary {
  const activeDaemonKeys = new Set<string>();
  const summary = targets.reduce<PanelSummary>(
    (acc, entry) => {
      acc.totalTargets += 1;
      if (entry.status.lastBuild?.status === 'building') {
        acc.building += 1;
      } else if (entry.status.lastBuild?.status === 'failure') {
        acc.failures += 1;
        acc.targetFailures = (acc.targetFailures ?? 0) + 1;
      }
      if (entry.status.process?.isActive) {
        const pid = entry.status.process.pid;
        const key =
          typeof pid === 'number' || typeof pid === 'string' ? String(pid) : `target:${entry.name}`;
        activeDaemonKeys.add(key);
      }
      return acc;
    },
    {
      totalTargets: 0,
      building: 0,
      failures: 0,
      targetFailures: 0,
      scriptFailures: options?.scriptFailures ?? 0,
      running: 0,
      activeDaemons: [],
    }
  );

  const targetFailures = summary.targetFailures ?? 0;
  const scriptFailures = summary.scriptFailures ?? 0;
  summary.failures = targetFailures + scriptFailures;
  summary.running = activeDaemonKeys.size;
  summary.activeDaemons = Array.from(activeDaemonKeys);
  return summary;
}

export function computePreferredIndex(targets: TargetPanelEntry[]): number {
  if (targets.length === 0) {
    return 0;
  }
  const buildingIndex = targets.findIndex((entry) => entry.status.lastBuild?.status === 'building');
  if (buildingIndex !== -1) {
    return buildingIndex;
  }
  const failedIndex = targets.findIndex((entry) => entry.status.lastBuild?.status === 'failure');
  if (failedIndex !== -1) {
    return failedIndex;
  }
  return 0;
}
