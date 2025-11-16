import { describe, expect, it } from 'vitest';
import {
  getDefaultSummaryMode,
  getSummaryModes,
  hasSummaryRow,
} from '../../src/panel/panel-state.js';
import type { PanelSnapshot } from '../../src/panel/types.js';

const baseSnapshot = (): PanelSnapshot => ({
  projectName: 'p',
  projectRoot: '/p',
  preferredIndex: 0,
  lastUpdated: Date.now(),
  targets: [],
  summary: { totalTargets: 0, building: 0, failures: 0, running: 0 },
  git: {
    branch: 'main',
    hasRepo: true,
    dirtyFiles: 0,
    dirtyFileNames: [],
    insertions: 0,
    deletions: 0,
  },
});

describe('panel-state summary defaults', () => {
  it('prefers summary modes that have data', () => {
    const snapshot = baseSnapshot();
    snapshot.git.summary = ['Changes: foo'];
    const modes = getSummaryModes(snapshot);
    expect(modes.find((m) => m.key === 'ai')?.hasData).toBe(true);
    expect(getDefaultSummaryMode(snapshot)).toBe('ai');
    expect(hasSummaryRow(snapshot)).toBe(true);
  });

  it('falls back to first mode when no data', () => {
    const snapshot = baseSnapshot();
    const modes = getSummaryModes(snapshot);
    expect(modes[0]?.hasData).toBe(false);
    expect(getDefaultSummaryMode(snapshot)).toBe(modes[0]?.key ?? 'ai');
    expect(hasSummaryRow(snapshot)).toBe(true);
  });
});
