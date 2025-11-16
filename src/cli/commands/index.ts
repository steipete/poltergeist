import type { Command } from 'commander';
import { registerDaemonCommands } from './daemon.js';
import { registerStatusCommands } from './status.js';
import { registerProjectCommands } from './project.js';
import { registerPolterCommand } from './polter.js';
import { registerVersionCommand } from './version.js';

export type CommandRegistrar = (program: Command) => void;

export const COMMAND_REGISTRARS: CommandRegistrar[] = [
  registerDaemonCommands,
  registerStatusCommands,
  registerProjectCommands,
  registerPolterCommand,
  registerVersionCommand,
];

export const registerCliCommands = (program: Command): void => {
  COMMAND_REGISTRARS.forEach((register) => register(program));
};
