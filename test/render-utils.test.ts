import { describe, expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import { progressBar } from '../src/panel/render-utils.js';

describe('render-utils progressBar', () => {
  it('uses ASCII characters so it renders on limited fonts', () => {
    const bar = stripAnsi(progressBar(50, 12));
    expect(bar).toMatch(/^\[=+\.+\]$/);
    expect(bar).not.toMatch(/[^\x20-\x7E]/);
  });
});
