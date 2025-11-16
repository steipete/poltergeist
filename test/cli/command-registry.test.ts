import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerCliCommands } from '../../src/cli/commands/index.js';
import { COMMAND_DESCRIPTORS } from '../../src/cli/commands/registry.js';

describe('command registry', () => {
  it('has descriptors for all registered commands', () => {
    const program = new Command();
    registerCliCommands(program);

    const registered = program.commands.map((c) => c.name()).sort();
    const described = COMMAND_DESCRIPTORS.map((d) => d.name).sort();

    expect(described).toEqual(registered);
  });
});
