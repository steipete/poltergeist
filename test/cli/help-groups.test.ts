import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerCliCommands } from '../../src/cli/commands/index.js';
import { COMMAND_DESCRIPTORS, HELP_GROUPS } from '../../src/cli/commands/registry.js';

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

describe('help groups', () => {
  it('reference only registered commands', () => {
    const program = new Command();
    registerCliCommands(program);
    const registered = new Set<string>();
    program.commands.forEach((command) => {
      registered.add(command.name());
      for (const alias of command.aliases()) {
        registered.add(alias);
      }
    });

    const grouped = HELP_GROUPS.flatMap((g) => g.commands.map((c) => c.name));

    grouped.forEach((name) => {
      expect(registered.has(name)).toBe(true);
    });
  });

  it('descriptor command expansions cover help groups', () => {
    const described = new Set(
      expandDescriptorNames(COMMAND_DESCRIPTORS.map((d) => d.name)).concat(['start', 'rest'])
    );
    const grouped = HELP_GROUPS.flatMap((g) => g.commands.map((c) => c.name));

    grouped.forEach((name) => {
      expect(described.has(name)).toBe(true);
    });
  });
});
