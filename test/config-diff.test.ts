import { describe, expect, it } from 'vitest';
import { detectConfigChanges } from '../src/utils/config-diff.js';
import { createTestConfig } from './helpers.js';

describe('detectConfigChanges', () => {
  it('detects target additions and removals', () => {
    const base = createTestConfig();
    const next = createTestConfig({
      targets: [
        ...base.targets,
        {
          ...base.targets[0],
          name: 'new-target',
        },
      ],
    });

    const changes = detectConfigChanges(base, next);

    expect(changes.targetsAdded.map((t) => t.name)).toEqual(['new-target']);
    expect(changes.targetsRemoved).toEqual([]);
    expect(changes.targetsModified).toEqual([]);
  });

  it('detects removals, modifications, and config changes', () => {
    const base = createTestConfig();
    const modifiedTarget = { ...base.targets[0], buildCommand: 'pnpm run build:fast' };

    const next = {
      ...base,
      targets: [modifiedTarget], // remove others, modify first
      watchman: { ...base.watchman, maxFileEvents: 20000 },
      notifications: { enabled: true, successSound: 'ding' },
      buildScheduling: {
        parallelization: 3,
        prioritization: {
          enabled: true,
          focusDetectionWindow: 10_000,
          priorityDecayTime: 20_000,
          buildTimeoutMultiplier: 1.5,
        },
      },
    };

    const changes = detectConfigChanges(base, next);

    expect(changes.targetsAdded).toEqual([]);
    expect(changes.targetsRemoved).toEqual([]);
    expect(changes.targetsModified).toHaveLength(1);
    expect(changes.targetsModified[0]?.name).toBe(modifiedTarget.name);
    expect(changes.watchmanChanged).toBe(true);
    expect(changes.notificationsChanged).toBe(true);
    expect(changes.buildSchedulingChanged).toBe(true);
  });
});
