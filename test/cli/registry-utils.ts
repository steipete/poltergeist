import { Command } from 'commander';
import { registerCliCommands } from '../../src/cli/commands/index.js';
import type { CommandDescriptor } from '../../src/cli/commands/registry.js';

export const descriptorExpansions: Record<string, string[]> = {
  daemon: ['haunt', 'stop', 'restart', 'build', 'start', 'rest'],
  status: ['panel', 'status', 'logs', 'wait'],
  project: ['init', 'list', 'clean'],
  polter: ['polter'],
  version: ['version'],
};

export const expandDescriptorNames = (descriptors: CommandDescriptor[]): string[] =>
  descriptors.flatMap((d) => descriptorExpansions[d.name] ?? [d.name]);

export const collectRegisteredNames = (): Set<string> => {
  const program = new Command();
  registerCliCommands(program);
  const names = new Set<string>();
  program.commands.forEach((c) => {
    names.add(c.name());
    c.aliases().forEach((a) => names.add(a));
  });
  return names;
};
