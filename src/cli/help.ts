import { Command } from 'commander';
import { CLIFormatter, type CommandGroup, type OptionInfo } from '../utils/cli-formatter.js';

export const configureProgramHelp = (program: Command): void => {
  program.configureHelp({
    formatHelp: () => {
      const commandGroups: CommandGroup[] = [
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

      const options: OptionInfo[] = [
        { flags: '-v, --version', description: 'Show version' },
        { flags: '-h, --help', description: 'Show help' },
      ];

      return CLIFormatter.formatHelp({
        title: 'Poltergeist',
        tagline: 'The ghost that keeps your projects fresh',
        programName: 'poltergeist',
        usage: '<command> [options]',
        commandGroups,
        options,
        examples: [
          { command: 'start', description: 'Start watching all enabled targets' },
          { command: 'start --target my-app', description: 'Watch specific target only' },
          { command: 'status --verbose', description: 'Show detailed status' },
          { command: 'logs my-app', description: 'Show logs for specific target' },
        ],
      });
    },
  });
};
