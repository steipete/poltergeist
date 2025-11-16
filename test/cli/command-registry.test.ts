import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerCliCommands } from '../../src/cli/commands/index.js';
import { COMMAND_DESCRIPTORS } from '../../src/cli/commands/registry.js';

const expandDescriptorNames = (names: string[]): string[] => {
  const expansions: Record<string, string[]> = {
    daemon: ['haunt', 'stop', 'restart', 'build'],
    status: ['panel', 'status', 'logs', 'wait'],
    project: ['init', 'list', 'clean'],
    polter: ['polter'],
    version: ['version'],
  };
  return names.flatMap((n) => expansions[n] ?? [n]);
};

describe('command registry', () => {
  it('covers all registered commands', () => {
    const program = new Command();
    registerCliCommands(program);
    const registered = program.commands.map((c) => c.name()).sort();

    const described = expandDescriptorNames(COMMAND_DESCRIPTORS.map((d) => d.name)).sort();

    expect(described).toEqual(registered);
  });
});
