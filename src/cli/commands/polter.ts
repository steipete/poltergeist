import type { Command } from 'commander';
import {
  configurePolterCommand,
  getPolterDescription,
  parsePolterOptions,
} from '../../cli-shared/polter-command.js';
import { loadRunWrapper } from '../loaders.js';

export const registerPolterCommand = (program: Command): void => {
  const polterCommand = program
    .command('polter <target> [args...]')
    .description(getPolterDescription());

  configurePolterCommand(polterCommand);

  polterCommand.action(async (target: string, args: string[], options) => {
    const runWrapper = await loadRunWrapper();
    const parsedOptions = parsePolterOptions(options);
    await runWrapper(target, args, parsedOptions);
  });
};
