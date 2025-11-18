import { describe, expect, it } from 'vitest';

import { formatHeader } from '../../src/panel/render-utils.js';
import type { PanelSnapshot } from '../../src/panel/types.js';

const baseSnapshot: PanelSnapshot = {
  targets: [],
  summary: { totalTargets: 3, building: 0, failures: 0, running: 1 },
  git: { branch: 'main', hasRepo: true, dirtyFiles: 0, insertions: 0, deletions: 0 },
  projectName: 'Peekaboo',
  projectRoot: '/Users/me/Projects/Peekaboo',
  preferredIndex: 0,
  lastUpdated: Date.now(),
  statusScripts: [],
  summaryScripts: [],
  paused: false,
};

describe('header summary building text', () => {
  it('hides building count when zero', () => {
    const header = formatHeader(
      { ...baseSnapshot, summary: { ...baseSnapshot.summary, building: 0 } },
      70
    );
    expect(header).not.toContain('0 building');
  });

  it('shows building count when > 0', () => {
    const header = formatHeader(
      { ...baseSnapshot, summary: { ...baseSnapshot.summary, building: 2 } },
      70
    );
    expect(header).toContain('2 building');
  });
});
