import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { parseGitSummaryModeOption } from '../../src/cli/configuration.js';

describe('parseGitSummaryModeOption', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 'unknown'}`);
  }) as never);

  afterEach(() => {
    exitSpy.mockClear();
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  it('returns normalized values for known modes', () => {
    expect(parseGitSummaryModeOption('AI')).toBe('ai');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(parseGitSummaryModeOption('list')).toBe('list');
  });

  it('exits for invalid modes', () => {
    expect(() => parseGitSummaryModeOption('invalid-mode')).toThrow(/exit:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
