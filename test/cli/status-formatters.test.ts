import { describe, expect, it } from 'vitest';
import { formatStatus } from '../../src/cli/status-formatters.js';

const ansiPattern = /\\u001B\[[0-9;]*m/g;
const stripAnsi = (value: string): string => value.replace(ansiPattern, '');

describe('formatStatus', () => {
  it('highlights known statuses with symbols', () => {
    expect(stripAnsi(formatStatus('success'))).toBe('✅ Success');
    expect(stripAnsi(formatStatus('failure'))).toBe('❌ Failed');
    expect(stripAnsi(formatStatus('building'))).toBe('🔨 Building');
    expect(stripAnsi(formatStatus('watching'))).toBe('👀 Watching');
  });

  it('falls back to gray text for unknown statuses', () => {
    expect(stripAnsi(formatStatus('custom-state'))).toBe('custom-state');
  });
});
