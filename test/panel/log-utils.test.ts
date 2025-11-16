import { describe, expect, it } from 'vitest';
import {
  filterBuildLogs,
  filterTestLogs,
  formatLogs,
  LOG_OVERHEAD_LINES,
} from '../../src/panel/log-utils.js';
import { stripAnsiCodes } from '../../src/panel/render-utils.js';
import type { TargetPanelEntry } from '../../src/panel/types.js';

const makeEntry = (name: string): TargetPanelEntry => ({
  name,
  status: {},
  targetType: 'test',
  enabled: true,
  logChannels: ['build'],
});

describe('log utils', () => {
  it('filters test logs but falls back when no matches', () => {
    const lines = ['build step', 'tests passed', 'deploy'];
    expect(filterTestLogs(lines)).toEqual(['tests passed']);
    expect(filterTestLogs(['build only'])).toEqual(['build only']);
  });

  it('filters build logs but falls back when all lines are tests', () => {
    const lines = ['tests passed', 'describe suite'];
    expect(filterBuildLogs(['build step', 'deploy'])).toEqual(['build step', 'deploy']);
    expect(filterBuildLogs(lines)).toEqual(lines);
  });

  it('centers the no-logs placeholder within available width', () => {
    const entry = makeEntry('cli');
    const output = formatLogs(entry, 'build', [], 24, LOG_OVERHEAD_LINES, 'all');
    const lines = output.split('\n');
    const last = stripAnsiCodes(lines[lines.length - 1]);
    const leftPad = last.indexOf('(no logs)');
    const rightPad = last.length - leftPad - '(no logs)'.length;
    expect(Math.abs(leftPad - rightPad)).toBeLessThanOrEqual(1);
  });

  it('wraps long log lines to available width', () => {
    const entry = makeEntry('cli');
    const output = formatLogs(entry, 'build', ['a long line with spaces'], 12, 10, 'all');
    const content = output.split('\n').slice(3).join('\n'); // skip header + divider
    const plain = stripAnsiCodes(content);
    // Expect multiple lines due to wrapping.
    expect(plain.split('\n').length).toBeGreaterThan(1);
  });

  it('respects maxLines after wrapping by keeping the tail', () => {
    const entry = makeEntry('cli');
    const output = formatLogs(entry, 'build', ['line1', 'line2', 'line3', 'line4'], 20, 2, 'all');
    const lines = stripAnsiCodes(output).split('\n').slice(3); // skip header + divider
    expect(lines).toEqual(['line3', 'line4']);
  });

  it('splits embedded newlines into separate log entries', () => {
    const entry = makeEntry('cli');
    const output = formatLogs(entry, 'build', ['line1\nline2', 'line3'], 30, 10, 'all');
    const lines = stripAnsiCodes(output).split('\n').slice(3); // skip header + divider
    expect(lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('applies maxLines after expanding multiline entries', () => {
    const entry = makeEntry('cli');
    const output = formatLogs(entry, 'build', ['a\nb\nc\nd'], 30, 2, 'all');
    const lines = stripAnsiCodes(output).split('\n').slice(3); // skip header + divider
    expect(lines).toEqual(['c', 'd']);
  });
});
