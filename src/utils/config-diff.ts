import type { PoltergeistConfig, Target } from '../types.js';

export interface ConfigChanges {
  targetsAdded: Target[];
  targetsRemoved: string[];
  targetsModified: Array<{ name: string; oldTarget: Target; newTarget: Target }>;
  watchmanChanged: boolean;
  notificationsChanged: boolean;
  buildSchedulingChanged: boolean;
}

/**
 * Compare two configs and report granular changes.
 * Pure helper to keep Poltergeist orchestration lean and easily testable.
 */
export function detectConfigChanges(
  oldConfig: PoltergeistConfig,
  newConfig: PoltergeistConfig
): ConfigChanges {
  const oldTargets = new Map(oldConfig.targets.map((t) => [t.name, t] as const));
  const newTargets = new Map(newConfig.targets.map((t) => [t.name, t] as const));

  const targetsAdded: Target[] = [];
  const targetsRemoved: string[] = [];
  const targetsModified: Array<{ name: string; oldTarget: Target; newTarget: Target }> = [];

  for (const [name, target] of newTargets) {
    if (!oldTargets.has(name)) {
      targetsAdded.push(target);
      continue;
    }

    const oldTarget = oldTargets.get(name);
    if (oldTarget && JSON.stringify(oldTarget) !== JSON.stringify(target)) {
      targetsModified.push({ name, oldTarget, newTarget: target });
    }
  }

  for (const [name] of oldTargets) {
    if (!newTargets.has(name)) {
      targetsRemoved.push(name);
    }
  }

  const watchmanChanged =
    JSON.stringify(oldConfig.watchman || {}) !== JSON.stringify(newConfig.watchman || {});
  const notificationsChanged =
    JSON.stringify(oldConfig.notifications || {}) !== JSON.stringify(newConfig.notifications || {});
  const buildSchedulingChanged =
    JSON.stringify(oldConfig.buildScheduling || {}) !==
    JSON.stringify(newConfig.buildScheduling || {});

  return {
    targetsAdded,
    targetsRemoved,
    targetsModified,
    watchmanChanged,
    notificationsChanged,
    buildSchedulingChanged,
  };
}
