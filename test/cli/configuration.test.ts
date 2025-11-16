import { describe, expect, it } from 'vitest';
import { parseGitSummaryModeOption } from '../../src/cli/configuration.js';

describe('parseGitSummaryModeOption', () => {
  it('returns normalized values for known modes', () => {
    expect(parseGitSummaryModeOption('AI')).toBe('ai');
    expect(parseGitSummaryModeOption('list')).toBe('list');
  });

  it('throws for invalid modes', () => {
    expect(() => parseGitSummaryModeOption('invalid-mode')).toThrow(
      'Invalid git mode "invalid-mode". Use "ai" or "list".'
    );
  });
});
