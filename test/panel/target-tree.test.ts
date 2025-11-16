import { describe, expect, it } from 'vitest';
import { buildTargetRows } from '../../src/panel/target-tree.js';
import type { TargetPanelEntry } from '../../src/panel/types.js';

const makeTarget = (name: string, group?: string): TargetPanelEntry => ({
  name,
  status: {},
  targetType: 'test',
  enabled: true,
  logChannels: ['build', 'unit'],
  group,
});

describe('target tree flattening', () => {
  it('keeps standalone targets flat', () => {
    const rows = buildTargetRows([makeTarget('A'), makeTarget('B')]);
    expect(rows.map((r) => r.target.name)).toEqual(['A', 'B']);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it('puts group header before its children with connectors', () => {
    const rows = buildTargetRows([
      makeTarget('Tests'),
      makeTarget('Unit', 'Tests'),
      makeTarget('Integration', 'Tests'),
    ]);
    expect(rows.map((r) => [r.target.name, r.depth, r.connector])).toEqual([
      ['Tests', 0, 'root'],
      ['Unit', 1, 'middle'],
      ['Integration', 1, 'last'],
    ]);
  });

  it('orders groups by first appearance and preserves child order', () => {
    const rows = buildTargetRows([
      makeTarget('X'),
      makeTarget('Tests'),
      makeTarget('B', 'Suite'),
      makeTarget('Suite'),
      makeTarget('A', 'Suite'),
    ]);
    expect(rows.map((r) => r.target.name)).toEqual(['X', 'Tests', 'Suite', 'B', 'A']);
  });

  it('marks a lone child with single connector', () => {
    const rows = buildTargetRows([makeTarget('Suite'), makeTarget('Only', 'Suite')]);
    expect(rows.map((r) => [r.target.name, r.depth, r.connector])).toEqual([
      ['Suite', 0, 'root'],
      ['Only', 1, 'single'],
    ]);
  });
});
