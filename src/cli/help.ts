import type { Command } from 'commander';
import { CLIFormatter, type CommandGroup, type OptionInfo } from '../utils/cli-formatter.js';
import { HELP_GROUPS } from './commands/registry.js';

export const configureProgramHelp = (program: Command): void => {
  program.configureHelp({
    formatHelp: () => {
      const options: OptionInfo[] = [
        { flags: '-v, --version', description: 'Show version' },
        { flags: '-h, --help', description: 'Show help' },
      ];

      return CLIFormatter.formatHelp({
        title: 'Poltergeist',
        tagline: 'The ghost that keeps your projects fresh',
        programName: 'poltergeist',
        usage: '<command> [options]',
        commandGroups: HELP_GROUPS as CommandGroup[],
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
