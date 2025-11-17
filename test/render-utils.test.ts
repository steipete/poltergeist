import { describe, expect, it } from 'vitest';
import { progressBar } from '../src/panel/render-utils.js';

const ESC = String.fromCharCode(27);
const ansiPattern = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const stripAnsi = (value: string): string => value.replace(ansiPattern, '');

describe('render-utils progressBar', () => {
  it('falls back to ASCII when POLTERGEIST_ASCII_BAR=1', () => {
    process.env.POLTERGEIST_ASCII_BAR = '1';
    const bar = stripAnsi(progressBar(50, 12));
    expect(bar).toMatch(/^\[=+[-]+\]$/);
    expect(bar).not.toMatch(/[^\x20-\x7E]/);
    delete process.env.POLTERGEIST_ASCII_BAR;
  });
});
