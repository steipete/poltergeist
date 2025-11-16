import type { Command } from 'commander';
import { COMMAND_DESCRIPTORS } from './registry.js';

export const registerCliCommands = (program: Command): void => {
  for (const { register } of COMMAND_DESCRIPTORS) {
    register(program);
  }
};
