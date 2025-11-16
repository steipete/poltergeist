import chalk from 'chalk';
import { spawn } from 'child_process';
import { resolve as resolvePath } from 'path';

import type { Target } from '../types.js';
import { poltergeistMessage } from '../utils/ghost.js';
import { type LaunchInfo, LaunchPreparationError, prepareLaunchInfo } from '../utils/launch.js';
import { isBinaryFresh, resolveBinaryPath } from './binaries.js';
import { getTimeAgo } from './time.js';

export async function executeStaleWithWarning(
  targetName: string,
  projectRoot: string,
  args: string[],
  options: { verbose: boolean }
): Promise<number> {
  const binaryPath = resolveBinaryPath(targetName, projectRoot);

  if (!binaryPath) {
    console.error(
      chalk.red(poltergeistMessage('error', `Binary not found for target '${targetName}'`))
    );
    console.error(chalk.yellow('Tried the following locations:'));
    for (const path of [
      resolvePath(projectRoot, targetName),
      resolvePath(projectRoot, `./${targetName}`),
      resolvePath(projectRoot, `./build/${targetName}`),
      resolvePath(projectRoot, `./dist/${targetName}`),
      resolvePath(projectRoot, `./${targetName}.js`),
      resolvePath(projectRoot, `./build/${targetName}.js`),
      resolvePath(projectRoot, `./dist/${targetName}.js`),
    ]) {
      console.error(chalk.gray(`   ${path}`));
    }
    console.error(chalk.yellow('   Try running: poltergeist start'));
    return 1;
  }

  const fresh = await isBinaryFresh(projectRoot, targetName, binaryPath);

  if (!fresh) {
    console.warn(
      chalk.yellow(poltergeistMessage('warning', '⚠ Executing potentially stale binary'))
    );
    console.warn(chalk.yellow('   The binary may be outdated. For fresh builds:'));
    console.warn(chalk.yellow('   npm run poltergeist:haunt'));
    console.warn('');
  }

  if (options.verbose) {
    console.log(chalk.gray(poltergeistMessage('info', `Project root: ${projectRoot}`)));
    console.log(chalk.gray(poltergeistMessage('info', `Binary path: ${binaryPath}`)));
    if (!fresh) {
      console.log(
        chalk.yellow(
          poltergeistMessage('warning', '⚠ Status: Executing without build verification')
        )
      );
    }
  }

  const freshnessLabel = fresh ? 'fresh' : 'potentially stale';
  console.log(
    chalk.green(poltergeistMessage('success', `Running binary: ${targetName} (${freshnessLabel})`))
  );

  return new Promise((resolve) => {
    let command: string;
    let commandArgs: string[];

    const ext = binaryPath?.toLowerCase();
    if (ext?.endsWith('.js') || ext?.endsWith('.mjs')) {
      command = 'node';
      commandArgs = [binaryPath, ...args];
    } else if (ext?.endsWith('.py')) {
      command = 'python';
      commandArgs = [binaryPath, ...args];
    } else if (ext?.endsWith('.sh')) {
      command = 'sh';
      commandArgs = [binaryPath, ...args];
    } else {
      command = binaryPath;
      commandArgs = args;
    }

    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      cwd: projectRoot,
    });

    child.on('error', (error: Error) => {
      console.error(chalk.red(poltergeistMessage('error', `Failed to execute ${targetName}:`)));
      console.error(chalk.red(`   ${error.message}`));

      if (error.message.includes('ENOENT')) {
        console.error(chalk.yellow('   Tips:'));
        console.error('   • Check if the binary exists and is executable');
        console.error('   • Try running: poltergeist start');
        console.error('   • Verify the output path in your configuration');
      } else if (error.message.includes('EACCES')) {
        console.error(chalk.yellow('   Permission denied:'));
        console.error(`   • Run: chmod +x ${binaryPath}`);
        console.error('   • Check file permissions');
      }

      resolve(1);
    });

    child.on('exit', (code: number | null) => {
      resolve(code || 0);
    });
  });
}

export function executeTarget(
  target: Target,
  projectRoot: string,
  args: string[],
  options: { verbose: boolean }
): Promise<number> {
  let launchInfo: LaunchInfo;
  try {
    launchInfo = prepareLaunchInfo(target, projectRoot, args);
  } catch (error) {
    if (error instanceof LaunchPreparationError) {
      if (error.code === 'NO_OUTPUT_PATH') {
        console.error(
          chalk.red(
            poltergeistMessage('error', `Target '${error.targetName}' does not have an output path`)
          )
        );
      } else {
        console.error(
          chalk.red(
            poltergeistMessage('error', `Binary not found: ${error.binaryPath ?? '<unknown>'}`)
          )
        );
        console.error(chalk.yellow('   Try running: poltergeist start'));
      }
      return Promise.resolve(1);
    }
    throw error;
  }

  return new Promise((resolve) => {
    if (options.verbose) {
      console.log(
        chalk.green(poltergeistMessage('success', `Running fresh binary: ${target.name}`))
      );
    }

    const child = spawn(launchInfo.command, launchInfo.commandArgs, {
      stdio: 'inherit',
      cwd: projectRoot,
    });

    child.on('error', (error: Error) => {
      console.error(chalk.red(poltergeistMessage('error', `Failed to execute ${target.name}:`)));
      console.error(chalk.red(`   ${error.message}`));

      if (error.message.includes('ENOENT')) {
        console.error(chalk.yellow('   Tips:'));
        console.error('   • Check if the binary exists and is executable');
        console.error('   • Try running: poltergeist start');
        console.error('   • Verify the output path in your configuration');
      } else if (error.message.includes('EACCES')) {
        console.error(chalk.yellow('   Permission denied:'));
        console.error(`   • Run: chmod +x ${launchInfo.binaryPath}`);
        console.error('   • Check file permissions');
      }

      resolve(1);
    });

    child.on('exit', (code: number | null) => {
      resolve(code || 0);
    });
  });
}

export function summarizeFailureOutput(
  state: PoltergeistStateWithError,
  opts: { verbose: boolean }
): void {
  if (state.lastBuildError) {
    const { exitCode, errorOutput, timestamp } = state.lastBuildError;
    const timeAgo = timestamp ? getTimeAgo(new Date(timestamp)) : 'at an unknown time';
    console.error(chalk.gray(`   Failed ${timeAgo} with exit code ${exitCode}`));

    if (errorOutput && errorOutput.length > 0) {
      errorOutput.slice(-3).forEach((line: string) => {
        console.error(chalk.gray(`     ${line}`));
      });
    }
  } else if (state.lastBuild?.errorSummary) {
    console.error(chalk.red(`   Error: ${state.lastBuild.errorSummary}`));
  }

  if (opts.verbose && state.lastBuild?.gitHash) {
    console.error(chalk.gray(`   Git hash: ${state.lastBuild.gitHash}`));
  }
}

type PoltergeistStateWithError = {
  lastBuildError?: {
    exitCode?: number;
    errorOutput?: string[];
    timestamp?: string;
  };
  lastBuild?: {
    errorSummary?: string;
    gitHash?: string;
  };
};
