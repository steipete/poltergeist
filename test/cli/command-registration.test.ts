import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerCliCommands } from '../../src/cli/commands/index.js';

describe('CLI command registration', () => {
  it('registers all top-level commands', () => {
    const program = new Command();

    registerCliCommands(program);

    const names = program.commands.map((cmd) => cmd.name());

    expect(names).toContain('haunt');
    expect(names).toContain('stop');
    expect(names).toContain('restart');
    expect(names).toContain('build');
    expect(names).toContain('panel');
    expect(names).toContain('status');
    expect(names).toContain('logs');
    expect(names).toContain('wait');
    expect(names).toContain('init');
    expect(names).toContain('list');
    expect(names).toContain('clean');
    expect(names).toContain('polter');
    expect(names).toContain('version');
  });
});
