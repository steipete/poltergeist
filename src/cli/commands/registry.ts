import type { Command } from 'commander';
import { registerDaemonCommands } from './daemon.js';
import { registerStatusCommands } from './status.js';
import { registerProjectCommands } from './project.js';
import { registerPolterCommand } from './polter.js';
import { registerVersionCommand } from './version.js';
import type { CommandGroup } from '../../utils/cli-formatter.js';

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

export const HELP_GROUPS: CommandGroup[] = [
  {
    title: 'Daemon Control',
    commands: [
      { name: 'start', aliases: ['haunt'], description: 'Start watching and auto-building' },
      { name: 'stop', aliases: ['rest'], description: 'Stop Poltergeist daemon' },
      { name: 'restart', description: 'Restart Poltergeist daemon' },
      { name: 'status', description: 'Check build and daemon status' },
    ],
  },
  {
    title: 'Project Management',
    commands: [
      { name: 'init', description: 'Initialize configuration' },
      { name: 'list', description: 'List all configured targets' },
      { name: 'clean', description: 'Clean up stale state files' },
    ],
  },
  {
    title: 'Development',
    commands: [
      { name: 'logs', args: '[target]', description: 'Show build logs' },
      { name: 'wait', args: '[target]', description: 'Wait for build to complete' },
      { name: 'polter', args: '<target> [args...]', description: 'Execute fresh binaries' },
      { name: 'panel', description: 'Interactive status dashboard' },
      { name: 'version', description: 'Show Poltergeist version' },
    ],
  },
];
