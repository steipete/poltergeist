import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerCliCommands } from '../../src/cli/commands/index.js';

const serializeCommand = (cmd: any) => ({
  name: cmd.name(),
  aliases: cmd.aliases(),
  options: cmd.options.map((opt: any) => opt.flags).sort(),
});

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

  it('keeps command aliases and common options aligned', () => {
    const program = new Command();
    registerCliCommands(program);

    const snapshot = Object.fromEntries(
      program.commands.map((cmd) => [cmd.name(), serializeCommand(cmd)])
    );

    expect(snapshot).toMatchSnapshot();
  });
});
