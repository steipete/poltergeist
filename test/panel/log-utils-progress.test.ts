import { describe, expect, it } from 'vitest';

import { formatProgress } from '../../src/panel/render-utils.js';

describe('formatProgress', () => {
  it('drops progress when percent is invalid or >=100', () => {
    expect(formatProgress({ percent: 100, current: 1, total: 1 }, 40)).toBeNull();
    expect(formatProgress({ percent: -1, current: 1, total: 1 }, 40)).toBeNull();
    expect(formatProgress({ percent: Number.NaN, current: 1, total: 1 }, 40)).toBeNull();
  });

  it('shrinks bar instead of truncating brackets/percent', () => {
    const text = formatProgress(
      { percent: 99, current: 14008, total: 14009, label: 'pipe_build_output' },
      24
    );
    expect(text).toBeDefined();
    // Ensure both brackets are preserved.
    expect(text?.includes('[')).toBe(true);
    expect(text?.includes(']')).toBe(true);
  });
});
