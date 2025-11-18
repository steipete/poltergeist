import { describe, expect, it } from 'vitest';

import { formatHeader } from '../../src/panel/render-utils.js';
import type { PanelSnapshot } from '../../src/panel/types.js';

const baseSnapshot: PanelSnapshot = {
  targets: [],
  summary: { totalTargets: 1, building: 0, failures: 0, running: 1 },
  git: {
    branch: 'main',
    hasRepo: true,
    dirtyFiles: 2,
    insertions: 1,
    deletions: 1,
  },
  projectName: 'Peekaboo',
  projectRoot: '/Users/me/Projects/Peekaboo',
  preferredIndex: 0,
  lastUpdated: Date.now(),
  statusScripts: [],
  summaryScripts: [],
  paused: false,
};

describe('formatHeader', () => {
  it('wraps header in a full-width box and centers lines', () => {
    const width = 50;
    const header = formatHeader(baseSnapshot, width);
    const lines = header.split('\n');
    expect(lines[0].length).toBe(width);
    expect(lines[0].startsWith('┌')).toBe(true);
    expect(lines.at(-1)).toBeDefined();
    expect(lines.at(-1)?.endsWith('┘')).toBe(true);

    const content = lines.slice(1, -1).map((line) => line.slice(1, -1)); // strip borders
    // Trimmed content should match the original strings.
    expect(content.some((l) => l.trim().startsWith('Peekaboo'))).toBe(true);
    // Centering: left and right padding differ by at most 1.
    content.forEach((l) => {
      const left = l.length - l.trimStart().length;
      const right = l.length - l.trimEnd().length;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    });
  });

  it('puts the paused notice as the last content line', () => {
    const snapshot: PanelSnapshot = {
      ...baseSnapshot,
      paused: true,
    };
    const header = formatHeader(snapshot, 60);
    const content = header
      .split('\n')
      .slice(1, -1)
      .map((line) => line.slice(1, -1).trim());
    const pausedIdx = content.findIndex((l) => l.includes('Auto-builds paused'));
    const summaryIdx = content.findIndex((l) => l.includes('building'));
    expect(pausedIdx).toBeGreaterThan(summaryIdx);
  });
});
