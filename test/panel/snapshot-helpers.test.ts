import { describe, expect, it } from 'vitest';
import { computePreferredIndex, computeSummary } from '../../src/panel/snapshot-helpers.js';
import type { TargetPanelEntry } from '../../src/panel/types.js';

const ACTIVE_PROCESS = {
  pid: 1234,
  hostname: 'localhost',
  isActive: true,
};

describe('snapshot-helpers', () => {
  it('computes summary with target and script failures', () => {
    const targets: TargetPanelEntry[] = [
      {
        name: 'building',
        status: { lastBuild: { status: 'building', timestamp: new Date().toISOString() } },
      },
      {
        name: 'failed',
        status: {
          lastBuild: { status: 'failure', timestamp: new Date().toISOString() },
          process: ACTIVE_PROCESS,
        },
      },
      {
        name: 'idle',
        status: { lastBuild: { status: 'success', timestamp: new Date().toISOString() } },
      },
    ];

    const summary = computeSummary(targets, { scriptFailures: 2 });
    expect(summary.totalTargets).toBe(3);
    expect(summary.building).toBe(1);
    expect(summary.targetFailures).toBe(1);
    expect(summary.scriptFailures).toBe(2);
    expect(summary.failures).toBe(3);
    expect(summary.running).toBe(1);
    expect(summary.activeDaemons).toEqual(['1234']);
  });

  it('prefers building target index, then failure, else zero', () => {
    const targets: TargetPanelEntry[] = [
      { name: 'ok', status: { lastBuild: { status: 'success', timestamp: 't' } } },
      { name: 'fail', status: { lastBuild: { status: 'failure', timestamp: 't' } } },
    ];
    expect(computePreferredIndex(targets)).toBe(1);

    const buildingFirst: TargetPanelEntry[] = [
      { name: 'build', status: { lastBuild: { status: 'building', timestamp: 't' } } },
      ...targets,
    ];
    expect(computePreferredIndex(buildingFirst)).toBe(0);

    expect(computePreferredIndex([])).toBe(0);
  });
});
