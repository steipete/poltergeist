import { describe, expect, it } from 'vitest';
import { formatLogs } from '../../src/panel/log-utils.js';
import type { TargetPanelEntry } from '../../src/panel/types.js';

const makeTarget = (name: string): TargetPanelEntry => ({
  name,
  status: {},
  targetType: 'test',
  enabled: true,
});

describe('formatLogs', () => {
  it('shows channel in header', () => {
    const text = formatLogs(makeTarget('Unit'), 'unit', ['ok'], 40, 10, 'all');
    expect(text).toContain('Unit');
    expect(text).toContain('unit');
  });

  it('centers no-logs message', () => {
    const width = 20;
    const text = formatLogs(makeTarget('Unit'), 'unit', [], width, 5, 'all');
    const lines = text.split('\n');
    const last = lines[lines.length - 1];
    expect(last.trim()).toBe('(no logs)');
    expect(last.length).toBeGreaterThan('(no logs)'.length); // padded/centered
  });
});
