import type { Command } from 'commander';
import { registerDaemonCommands } from './daemon.js';
import { registerStatusCommands } from './status.js';
import { registerProjectCommands } from './project.js';
import { registerPolterCommand } from './polter.js';
import { registerVersionCommand } from './version.js';

export interface CommandDescriptor {
  name: string;
  register: (program: Command) => void;
}

export const COMMAND_DESCRIPTORS: CommandDescriptor[] = [
  { name: 'daemon', register: registerDaemonCommands },
  { name: 'status', register: registerStatusCommands },
  { name: 'project', register: registerProjectCommands },
  { name: 'polter', register: registerPolterCommand },
  { name: 'version', register: registerVersionCommand },
];
