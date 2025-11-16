#!/usr/bin/env node
import chalk from 'chalk';
import { Command } from 'commander';
import { readFileSync, unlinkSync } from 'fs';
import { registerCliCommands } from './cli/commands/index.js';
import { configureDeprecatedFlags } from './cli/deprecated-flags.js';
import { configureProgramHelp } from './cli/help.js';
import { exitWithError } from './cli/shared.js';
import { PACKAGE_INFO } from './cli/version.js';
import { runDaemon } from './daemon/daemon-worker.js';
import { isMainModule } from './utils/paths.js';

const { version } = PACKAGE_INFO;

const program = new Command();

program
  .name('poltergeist')
  .description(`👻 ${chalk.cyan('Poltergeist - The ghost that keeps your projects fresh')}`)
  .version(version, '-v, --version', 'output the version number');

configureProgramHelp(program);
registerCliCommands(program);
configureDeprecatedFlags(program);

if (process.argv.includes('--daemon-mode')) {
  const daemonArgsIndex = process.argv.indexOf('--daemon-mode') + 1;
  const daemonArgsPath = process.argv[daemonArgsIndex];

  if (daemonArgsPath) {
    process.title = 'poltergeist-daemon';

    let daemonArgs = daemonArgsPath;

    if (daemonArgsPath.endsWith('.json')) {
      try {
        daemonArgs = readFileSync(daemonArgsPath, 'utf-8');
        setTimeout(() => {
          try {
            unlinkSync(daemonArgsPath);
          } catch {
            // Ignore cleanup errors
          }
        }, 1000);
      } catch (error) {
        exitWithError(`Failed to read daemon args file: ${error}`);
      }
    }

    try {
      const parsedArgs = JSON.parse(daemonArgs);
      runDaemon(parsedArgs).catch((error) => {
        exitWithError(`Failed to start daemon worker: ${error}`);
      });
    } catch (error) {
      exitWithError(`Failed to parse daemon args: ${error}`);
    }
  } else {
    exitWithError('Missing daemon arguments');
  }
} else {
  const invocationPath = process.argv[1] || '';
  const invocationName = process.argv0 || '';
  const isPolterInvocation =
    invocationPath.endsWith('/polter') ||
    invocationPath.endsWith('\\polter') ||
    invocationPath === 'polter' ||
    invocationName.endsWith('/polter') ||
    invocationName.endsWith('\\polter') ||
    invocationName === 'polter';

  if (isPolterInvocation) {
    import('./polter.js')
      .then(() => {
        // handled by polter module
      })
      .catch((err) => {
        exitWithError(`Failed to load polter: ${err}`);
      });
  } else {
    const isDirectRun = isMainModule();
    const isWrapperRun =
      process.argv[1]?.endsWith('poltergeist.ts') || process.argv[1]?.endsWith('poltergeist');

    const isBunBinary =
      process.argv[0]?.includes('/$bunfs/') ||
      (process.execPath && !process.execPath.endsWith('bun') && !process.execPath.endsWith('node'));

    if (isDirectRun || isWrapperRun || isBunBinary) {
      program.parse(process.argv);

      if (!process.argv.slice(2).length) {
        program.outputHelp();
      }
    }
  }
}

export { program };
