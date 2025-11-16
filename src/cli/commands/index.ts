import type { Command } from 'commander';
import { COMMAND_DESCRIPTORS } from './registry.js';

export const registerCliCommands = (program: Command): void => {
  COMMAND_DESCRIPTORS.forEach(({ register }) => register(program));
};
