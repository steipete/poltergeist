import type { Command } from 'commander';
import type { CommandGroup } from '../../utils/cli-formatter.js';
import { registerDaemonCommands } from './daemon.js';
import { registerPolterCommand } from './polter.js';
import { registerProjectCommands } from './project.js';
import { registerStatusCommands } from './status.js';
import { registerVersionCommand } from './version.js';

export interface CommandOptionDescriptor {
  flags: string;
  description: string;
  defaultValue?: string | boolean;
}

export interface CommandDescriptor {
  name: string;
  register: (program: Command) => void;
  options?: CommandOptionDescriptor[];
  aliases?: string[];
}

export const COMMAND_DESCRIPTORS: CommandDescriptor[] = [
  {
    name: 'daemon',
    register: registerDaemonCommands,
    options: [
      { flags: '-c, --config <path>', description: 'Path to config file' },
      {
        flags: '-t, --target <name>',
        description: 'Target to build (omit to build all enabled targets)',
      },
      { flags: '--verbose', description: 'Enable verbose logging (same as --log-level debug)' },
      { flags: '--log-level <level>', description: 'Set log level (debug, info, warn, error)' },
      { flags: '-f, --foreground', description: 'Run in foreground (blocking mode)' },
      { flags: '--json', description: 'Output build result as JSON (build)' },
      {
        flags: '-f, --force',
        description: 'Force rebuild even if another build is running (build)',
      },
    ],
    aliases: ['start', 'haunt', 'stop', 'rest', 'restart'],
  },
  {
    name: 'status',
    register: registerStatusCommands,
    options: [
      { flags: '-c, --config <path>', description: 'Path to config file' },
      { flags: '-t, --target <name>', description: 'Target to filter status/logs' },
      { flags: '--verbose', description: 'Show detailed status information' },
      { flags: '--json', description: 'Output status/logs/wait as JSON where supported' },
      { flags: '--git-mode <mode>', description: 'Git summary mode (ai | list)' },
      { flags: '-t, --tail <number>', description: 'Number of lines to show (logs)' },
      { flags: '-f, --follow', description: 'Follow log output (logs)' },
      { flags: '-C, --channel <name>', description: 'Log channel to display (default: build)' },
      { flags: '--timeout <seconds>', description: 'Maximum time to wait (wait)' },
    ],
    aliases: ['panel', 'logs', 'wait'],
  },
  {
    name: 'project',
    register: registerProjectCommands,
    options: [
      { flags: '-c, --config <path>', description: 'Path to config file' },
      { flags: '--dry-run', description: 'Show actions without writing files (init/clean)' },
      { flags: '--json', description: 'Output JSON summary for clean' },
      { flags: '--cmake', description: 'Initialize for CMake project (init)' },
      { flags: '--auto', description: 'Auto-detect project type (init)' },
      { flags: '--preset <name>', description: 'Use specific CMake preset (init)' },
      { flags: '--generator <gen>', description: 'CMake generator to use (init)' },
      { flags: '--build-dir <dir>', description: 'Build directory (init)' },
      {
        flags: '--no-auto-add',
        description: 'Skip auto-adding inferred targets when none are enabled (init)',
      },
      { flags: '-a, --all', description: 'Remove all state files (clean)' },
      { flags: '-d, --days <number>', description: 'Remove state files older than N days (clean)' },
    ],
    aliases: ['init', 'list', 'clean'],
  },
  {
    name: 'polter',
    register: registerPolterCommand,
    options: [
      { flags: '-f, --force', description: 'Run even if build failed' },
      { flags: '-w, --watch', description: 'Watch mode for polter' },
      { flags: '--no-logs', description: 'Skip log tailing' },
      { flags: '--log-lines <number>', description: 'Number of log lines to show' },
      { flags: '-n, --no-wait', description: 'Do not wait for build completion' },
      { flags: '-t, --timeout <ms>', description: 'Set build wait timeout in ms' },
      { flags: '--restart-signal <signal>', description: 'Signal used for restarts' },
      { flags: '--restart-delay <ms>', description: 'Delay before restart (ms)' },
      { flags: '--verbose', description: 'Verbose output' },
    ],
  },
  {
    name: 'version',
    register: registerVersionCommand,
    options: [{ flags: '-v, --version', description: 'Show version' }],
  },
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
