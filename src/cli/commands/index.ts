import type { Command } from 'commander';
import { COMMAND_DESCRIPTORS } from './registry.js';
import { applyDescriptorOptions } from './options-descriptors.js';

export const registerCliCommands = (program: Command): void => {
  COMMAND_DESCRIPTORS.forEach((descriptor) => {
    const scopedProgram = applyDescriptorOptions(program, descriptor);
    descriptor.register(scopedProgram);
  });
};
