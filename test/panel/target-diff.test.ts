import { describe, expect, it } from 'vitest';
import { diffTargets } from '../../src/panel/target-diff.js';
import type { TargetPanelEntry } from '../../src/panel/types.js';

describe('target-diff', () => {
  it('returns added and removed target names', () => {
    const current: TargetPanelEntry[] = [
      { name: 'a', status: { status: 'unknown' } },
      { name: 'b', status: { status: 'unknown' } },
    ];

    const next = [
      { name: 'b', type: 'custom', enabled: true },
      { name: 'c', type: 'custom', enabled: true },
    ];

    const diff = diffTargets(current, next);
    expect(diff.added).toEqual(['c']);
    expect(diff.removed).toEqual(['a']);
  });
});
