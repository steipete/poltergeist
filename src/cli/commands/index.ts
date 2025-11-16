import type { Command } from 'commander';
import { registerDaemonCommands } from './daemon.js';
import { registerStatusCommands } from './status.js';
import { registerProjectCommands } from './project.js';
import { registerPolterCommand } from './polter.js';
import { registerVersionCommand } from './version.js';

export const registerCliCommands = (program: Command): void => {
  registerDaemonCommands(program);
  registerStatusCommands(program);
  registerProjectCommands(program);
  registerPolterCommand(program);
  registerVersionCommand(program);
};
