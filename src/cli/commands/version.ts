import type { Command } from 'commander';
import { PACKAGE_INFO } from '../version.js';

export const registerVersionCommand = (program: Command): void => {
  const { version } = PACKAGE_INFO;
  program
    .command('version')
    .description('Show Poltergeist version')
    .action(() => {
      console.log(`Poltergeist v${version}`);
    });
};
