#!/usr/bin/env node

import { Command } from 'commander';
import {
  configurePolterCommand,
  getPolterDescription,
  parsePolterOptions,
  setupPolterErrorHandling,
} from './cli-shared/polter-command.js';
import { runWrapperWithDefaults } from './polter/runner.js';
import { isMainModule } from './utils/paths.js';

export { isBinaryFresh, resolveBinaryPath } from './polter/binaries.js';
export { runWrapper } from './polter/runner.js';

// Hardcoded version for compiled binary consistency
const packageJson = { version: '2.1.0', name: '@steipete/poltergeist' };

if (
  process.argv[1] &&
  (isMainModule() ||
    process.argv[1].endsWith('/polter') ||
    process.argv[1].endsWith('/polter.js') ||
    process.argv[1].endsWith('/polter.ts') ||
    process.argv[1].endsWith('\\polter.js') ||
    process.argv[1].endsWith('\\polter.ts'))
) {
  const program = new Command();

  const polterCommand = program
    .name('polter')
    .description(getPolterDescription())
    .version(packageJson.version, '-v, --version', 'output the version number')
    .argument('[target]', 'Name of the target to run')
    .argument('[args...]', 'Arguments to pass to the target executable')
    .helpOption(false)
    .option('-h, --help', 'Show help for polter');

  configurePolterCommand(polterCommand);

  polterCommand.action(async (target: string | undefined, args: string[], options) => {
    const parsedOptions = parsePolterOptions(options);
    await runWrapperWithDefaults(target, args, parsedOptions);
  });

  setupPolterErrorHandling();

  program.parse();
}
