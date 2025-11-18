import { describe, expect, it } from 'vitest';

import { formatTargets } from '../../src/panel/render-utils.js';
import type {
  PanelSnapshot,
  PanelStatusScriptResult,
  TargetPanelEntry,
} from '../../src/panel/types.js';

const target: TargetPanelEntry = {
  name: 'app',
  status: {
    status: 'success',
    lastBuild: { status: 'success', timestamp: new Date().toISOString() },
  },
  targetType: 'app-bundle',
  enabled: true,
  group: undefined,
  logChannels: [],
};

const snapshotBase: PanelSnapshot = {
  targets: [target],
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

const makeRows = (entries: TargetPanelEntry[]) =>
  entries.map((t) => ({ target: t, depth: 0, connector: 'single' as const }));

describe('formatTargets post-build rendering', () => {
  it('collapses successful post-build details', () => {
    const entry: TargetPanelEntry = {
      ...target,
      status: {
        status: 'success',
        lastBuild: { status: 'success', timestamp: new Date().toISOString() },
        postBuild: [
          {
            name: 'Swift tests',
            status: 'success',
            summary: 'Swift tests: success [1s]',
            durationMs: 1000,
            lines: ['should not be shown'],
          },
        ],
      },
    };

    const text = formatTargets(
      makeRows([entry]),
      0,
      new Map<string, PanelStatusScriptResult[]>(),
      80,
      undefined,
      [],
      [],
      undefined,
      snapshotBase,
      []
    );

    expect(text).toContain('Swift tests: success');
    expect(text).not.toContain('should not be shown');
  });

  it('shows failure hint (exit code) for failed post-build', () => {
    const entry: TargetPanelEntry = {
      ...target,
      status: {
        status: 'failure',
        lastBuild: { status: 'failure', timestamp: new Date().toISOString() },
        postBuild: [
          {
            name: 'Swift tests',
            status: 'failure',
            summary: 'Swift tests failed',
            durationMs: 1200,
            lines: ['Build failed with exit code 134'],
          },
        ],
      },
    };

    const text = formatTargets(
      makeRows([entry]),
      0,
      new Map<string, PanelStatusScriptResult[]>(),
      80,
      undefined,
      [],
      [],
      undefined,
      snapshotBase,
      []
    );

    expect(text).toContain('exit 134');
  });
});
