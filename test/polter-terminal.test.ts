import { describe, expect, it } from 'vitest';
import { envFlagEnabled, hasRichTTY } from '../src/polter/terminal.js';

const makeStream = (overrides: Partial<NodeJS.WriteStream> = {}) =>
  ({
    isTTY: true,
    columns: 80,
    rows: 24,
    getColorDepth: () => 24,
    ...overrides,
  }) as NodeJS.WriteStream;

describe('terminal helpers', () => {
  it('interprets environment flags consistently', () => {
    expect(envFlagEnabled(undefined)).toBe(false);
    expect(envFlagEnabled('')).toBe(false);
    expect(envFlagEnabled('0')).toBe(false);
    expect(envFlagEnabled('false')).toBe(false);
    expect(envFlagEnabled('no')).toBe(false);
    expect(envFlagEnabled('1')).toBe(true);
    expect(envFlagEnabled('TRUE')).toBe(true);
    expect(envFlagEnabled(' yes ')).toBe(true);
  });

  it('detects rich TTY when explicit overrides are provided', () => {
    const env = { TERM: 'xterm-256color' } as NodeJS.ProcessEnv;
    expect(hasRichTTY({ stdout: makeStream(), stderr: makeStream() }, env)).toBe(true);
  });

  it('disables TTY when CI or disable flags are set', () => {
    const env = { TERM: 'xterm-256color', CI: 'true' } as NodeJS.ProcessEnv;
    expect(hasRichTTY({ stdout: makeStream(), stderr: makeStream() }, env)).toBe(false);

    const envDisabled = { TERM: 'xterm-256color', POLTER_DISABLE_TTY: '1' } as NodeJS.ProcessEnv;
    expect(hasRichTTY({ stdout: makeStream(), stderr: makeStream() }, envDisabled)).toBe(false);
  });

  it('forces TTY when POLTER_FORCE_TTY is set', () => {
    const env = { POLTER_FORCE_TTY: '1' } as NodeJS.ProcessEnv;
    expect(hasRichTTY({ stdout: makeStream({ isTTY: false }), stderr: makeStream() }, env)).toBe(
      true
    );
  });
});
