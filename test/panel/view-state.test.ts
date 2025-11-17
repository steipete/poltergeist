import { describe, expect, it } from 'vitest';
import type { PanelSnapshot } from '../../src/panel/types.js';
import { buildPanelViewState } from '../../src/panel/view-state.js';

const baseSnapshot: PanelSnapshot = {
  targets: [
    {
      name: 'app',
      status: { status: 'success' },
      enabled: true,
      targetType: 'custom',
    },
  ],
  summary: {
    totalTargets: 1,
    building: 0,
    failures: 0,
    scriptFailures: 0,
    targetFailures: 0,
    running: 0,
    activeDaemons: [],
  },
  git: {
    hasRepo: true,
    branch: 'main',
    dirtyFiles: 0,
    dirtyFileNames: [],
    insertions: 0,
    deletions: 0,
    lastUpdated: Date.now(),
    summaryMode: 'ai',
  },
  projectName: 'demo',
  projectRoot: '/tmp/demo',
  preferredIndex: 0,
  lastUpdated: Date.now(),
  statusScripts: [],
  summaryScripts: [],
};

describe('buildPanelViewState', () => {
  it('propagates scriptBanner to view state', () => {
    const viewState = buildPanelViewState({
      snapshot: baseSnapshot,
      selectedRowIndex: 0,
      logLines: [],
      logViewMode: 'all',
      summaryMode: 'ai',
      logChannelLabel: 'default',
      width: 80,
      height: 40,
      shouldShowLogs: true,
      logOverheadLines: 2,
      scriptBanner: 'script failed',
    });

    expect(viewState.scriptBanner).toBe('script failed');
    // ensure log limit still non-negative with banner considered
    expect(viewState.logLimit).toBeGreaterThanOrEqual(0);
  });
});
