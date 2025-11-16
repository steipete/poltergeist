import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { progressBar } from '../src/panel/render-utils.js';

describe('render-utils progressBar', () => {
  it('falls back to ASCII when POLTERGEIST_ASCII_BAR=1', () => {
    process.env.POLTERGEIST_ASCII_BAR = '1';
    const bar = stripAnsi(progressBar(50, 12));
    expect(bar).toMatch(/^\[=+[-]+\]$/);
    expect(bar).not.toMatch(/[^\x20-\x7E]/);
    delete process.env.POLTERGEIST_ASCII_BAR;
  });
});
