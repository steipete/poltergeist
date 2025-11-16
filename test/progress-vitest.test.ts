import { describe, expect, it } from 'vitest';

import { parseVitestProgressLine } from '../src/builders/base-builder.js';

describe('parseVitestProgressLine', () => {
  it('parses mixed passed/failed totals', () => {
    const progress = parseVitestProgressLine('Tests 2 failed | 5 passed | 7 total');
    expect(progress).toEqual(
      expect.objectContaining({
        current: 7,
        total: 7,
        percent: 100,
        label: 'Vitest',
      })
    );
  });

  it('parses test files summary', () => {
    const progress = parseVitestProgressLine('Test Files 1 failed | 3 passed | 4 total');
    expect(progress).toEqual(
      expect.objectContaining({
        current: 4,
        total: 4,
        percent: 100,
      })
    );
  });

  it('ignores non-test lines', () => {
    expect(parseVitestProgressLine('Compiling 1/5')).toBeNull();
    expect(parseVitestProgressLine('Tests total 10')).toBeNull();
  });
});
