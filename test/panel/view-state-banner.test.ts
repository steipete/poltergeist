import { describe, expect, it } from 'vitest';

import { buildTargetRows } from '../../src/panel/target-tree.js';
import type { PanelSnapshot } from '../../src/panel/types.js';
import { buildPanelViewState } from '../../src/panel/view-state.js';

const snapshot: PanelSnapshot = {
  targets: [
    {
      name: 'app',
      status: {
        status: 'success',
        lastBuild: { status: 'success', timestamp: new Date().toISOString() },
      },
      targetType: 'app-bundle',
      enabled: true,
      group: undefined,
      logChannels: [],
    },
  ],
  summary: { totalTargets: 1, building: 0, failures: 0, running: 1 },
  git: { branch: 'main', hasRepo: true, dirtyFiles: 0, insertions: 0, deletions: 0 },
  projectName: 'app',
  projectRoot: '/tmp/app',
  preferredIndex: 0,
  lastUpdated: Date.now(),
  statusScripts: [],
  summaryScripts: [],
  paused: false,
};

describe('panel view state banners', () => {
  it('clips logs by banner height when logBanner is present', () => {
    const rows = buildTargetRows(snapshot.targets);
    const view = buildPanelViewState({
      snapshot,
      rows,
      selectedRowIndex: 0,
      logLines: Array.from({ length: 100 }, (_, i) => `line-${i}`),
      logBanner: 'Script failed',
      scriptBanner: undefined,
      logViewMode: 'all',
      summaryMode: 'ai',
      logChannelLabel: 'build',
      width: 80,
      height: 20,
      shouldShowLogs: true,
      logOverheadLines: 3,
    });

    // With banner consuming one line + overhead, limit should shrink.
    expect(view.logLimit).toBeLessThan(20);
    expect(view.logLines.length).toBe(view.logLimit);
  });

  it('keeps banner out of log Banner when not targeted', () => {
    const rows = buildTargetRows(snapshot.targets);
    const view = buildPanelViewState({
      snapshot,
      rows,
      selectedRowIndex: 0,
      logLines: [],
      logBanner: undefined,
      scriptBanner: 'Script elsewhere',
      logViewMode: 'all',
      summaryMode: 'ai',
      logChannelLabel: 'build',
      width: 80,
      height: 20,
      shouldShowLogs: true,
      logOverheadLines: 3,
    });

    expect(view.logBanner).toBeUndefined();
    expect(view.scriptBanner).toBe('Script elsewhere');
  });
});
