import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

const exitWithError = vi.fn((message?: string) => {
  throw new Error(message ?? 'exit');
});

vi.mock('../../src/cli/shared.js', () => ({ exitWithError }));

const { configureDeprecatedFlags } = await import('../../src/cli/deprecated-flags.js');

describe('deprecated flag handling', () => {
  it('fails fast when deprecated flags are used', () => {
    const program = new Command();

    configureDeprecatedFlags(program);

    expect(() => program.parse(['node', 'cli', '--cli'], { from: 'user' })).toThrow();
    expect(exitWithError).toHaveBeenCalled();
  });
});
