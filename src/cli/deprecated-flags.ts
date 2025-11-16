import chalk from 'chalk';
import type { Command } from 'commander';
import { exitWithError } from './shared.js';

const warnOldFlag = (flag: string, newFlag: string): never => {
  console.error(chalk.red(`❌ The ${flag} flag is no longer supported!`));
  console.error(chalk.yellow(`Use ${newFlag} instead.`));
  console.error(chalk.gray('\nExample:'));
  console.error(chalk.gray(`  poltergeist haunt ${newFlag}`));
  return exitWithError(`Deprecated flag ${flag} used`);
};

export const configureDeprecatedFlags = (program: Command): void => {
  program.option('--cli', '(deprecated) Use --target <name> instead');
  program.option('--mac', '(deprecated) Use --target <name> instead');

  program.on('option:cli', () => warnOldFlag('--cli', '--target <name>'));
  program.on('option:mac', () => warnOldFlag('--mac', '--target <name>'));
};
