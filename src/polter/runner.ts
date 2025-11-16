import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import type { ParsedPolterOptions } from '../cli-shared/polter-command.js';
import type { Target } from '../types.js';
import { ConfigurationManager } from '../utils/config-manager.js';
import { poltergeistMessage } from '../utils/ghost.js';
import { isBinaryFresh, resolveBinaryPath } from './binaries.js';
import {
  getBuildStatus,
  getStateFile,
  waitForBuildCompletion,
  warnIfBuildStaleByAge,
} from './build-status.js';
import { executeStaleWithWarning, executeTarget } from './execution.js';
import { showPolterHelp } from './help.js';
import { getTimeAgo } from './time.js';
import { runWithWatchMode } from './watch-mode.js';

async function runWrapperWithDefaults(
  targetName: string | undefined,
  args: string[],
  options: ParsedPolterOptions
) {
  if (options.help || !targetName) {
    await showPolterHelp();
    process.exit(0);
  }

  await runWrapper(targetName, args, options);
}

export async function runWrapper(targetName: string, args: string[], options: ParsedPolterOptions) {
  const isSilentTarget = targetName === 'peekaboo';
  const effectiveVerbose = isSilentTarget ? false : options.verbose;
  let poltergeistNotRunning = false;

  try {
    const discovery = await ConfigurationManager.discoverAndLoadConfig();
    if (!discovery) {
      if (options.verbose) {
        console.warn(
          chalk.yellow(
            '👻 [Poltergeist] ⚠ No poltergeist.config.json found - attempting stale execution'
          )
        );
      }

      const projectRoot = process.cwd();
      if (options.verbose) {
        console.log(
          chalk.gray(`👻 [Poltergeist] No config found, using cwd as project root: ${projectRoot}`)
        );
      }
      const exitCode = await executeStaleWithWarning(targetName, projectRoot, args, options);
      process.exit(exitCode);
    }

    const { config, projectRoot } = discovery;

    const target = ConfigurationManager.findTarget(config, targetName) as Target | undefined;
    if (!target) {
      if (options.verbose) {
        console.warn(
          chalk.yellow(
            `👻 [Poltergeist] ⚠ Target '${targetName}' not found in config - attempting stale execution`
          )
        );
      }

      const availableTargets = ConfigurationManager.getExecutableTargets(config).map((t) => t.name);
      if (availableTargets.length > 0) {
        console.warn(chalk.yellow('👻 [Poltergeist] Available configured targets:'));
        for (const name of availableTargets) {
          console.warn(chalk.yellow(`   - ${name}`));
        }
        console.warn('');
      }

      const staleExecutionRoot = process.cwd();
      const exitCode = await executeStaleWithWarning(targetName, staleExecutionRoot, args, options);
      process.exit(exitCode);
    }

    if (target.type !== 'executable') {
      console.error(
        chalk.red(
          `👻 [Poltergeist] Target '${targetName}' is not executable (type: ${target.type})`
        )
      );
      console.error(chalk.yellow('   polter only works with executable targets'));
      console.error('   • Executable targets have "type": "executable" in the config');
      console.error('   • Other target types are handled by Poltergeist daemon');
      process.exit(1);
    }

    if (effectiveVerbose) {
      console.log(chalk.gray(`👻 [Poltergeist] Project root: ${projectRoot}`));
      console.log(chalk.gray(`👻 [Poltergeist] Target: ${target.name} (${target.outputPath})`));
    }

    const status = await getBuildStatus(projectRoot, target);

    if (effectiveVerbose) {
      console.log(chalk.gray(`👻 [Poltergeist] Build status: ${status}`));
    }

    if (status === 'poltergeist-not-running') {
      poltergeistNotRunning = true;
      const binaryPath = resolveBinaryPath(target.name, projectRoot);
      const fresh = await isBinaryFresh(projectRoot, target.name, binaryPath);

      if (!isSilentTarget) {
        if (fresh) {
          console.log(
            chalk.green(
              poltergeistMessage(
                'success',
                'Running recently-built binary (daemon offline; freshness verified)'
              )
            )
          );
        } else {
          console.warn(chalk.yellow('👻 [Poltergeist] ⚠ Executing potentially stale binary'));
          console.warn(chalk.yellow('   The binary may be outdated. For fresh builds:'));
          console.warn(chalk.yellow('   pnpm run poltergeist:haunt'));
          console.warn('');
        }
      }
    }

    switch (status) {
      case 'poltergeist-not-running':
        break;
      case 'building': {
        if (options.noWait) {
          console.error(chalk.red('👻 [Poltergeist] Build in progress and --no-wait specified'));
          process.exit(1);
        }

        console.log(chalk.cyan('👻 [Poltergeist] Build in progress, waiting...'));
        const result = await waitForBuildCompletion(projectRoot, target, options.timeout, {
          showLogs: options.showLogs,
          logLines: options.logLines,
        });

        if (result === 'timeout') {
          console.error(chalk.red(`👻 [Poltergeist] Build timeout after ${options.timeout}ms`));
          console.error(chalk.yellow('   Solutions:'));
          console.error(
            `   • Increase timeout: polter ${targetName} --timeout ${options.timeout * 2}`
          );
          console.error('   • Check build logs: poltergeist logs');
          console.error('   • Verify Poltergeist is running: poltergeist status');
          process.exit(1);
        }

        if (result === 'failed' && !options.force) {
          console.error(chalk.red('👻 [Poltergeist] Build failed'));
          console.error(chalk.yellow('   Options:'));
          console.error('   • Check build logs: poltergeist logs');
          console.error(`   • Force execution anyway: polter ${targetName} --force`);
          console.error('   • Fix build errors and try again');
          process.exit(1);
        }

        if (result === 'failed' && options.force) {
          console.warn(
            chalk.yellow('👻 [Poltergeist] ⚠ Running despite build failure (--force specified)')
          );
        }
        break;
      }

      case 'failed': {
        try {
          const { StateManager } = await import('../state.js');
          const { createLogger } = await import('../logger.js');
          const logger = createLogger('error');
          const stateManager = new StateManager(projectRoot, logger);

          if (await stateManager.isLocked(targetName)) {
            console.log(
              chalk.yellow('👻 [Poltergeist] Detected active build lock, waiting for completion...')
            );
            const result = await waitForBuildCompletion(projectRoot, target, options.timeout, {
              showLogs: options.showLogs,
              logLines: options.logLines,
            });

            if (result === 'success') {
              break;
            } else if (result === 'timeout') {
              console.error(
                chalk.yellow('👻 [Poltergeist] Build appears stuck (lock present but no progress)')
              );
              console.error(chalk.yellow('   Solutions:'));
              console.error('   • Check for stuck build processes: ps aux | grep build');
              console.error('   • Clear the lock: poltergeist stop && poltergeist start');
              console.error('   • Force run anyway: Use --force flag');
            }
          }
        } catch (_e) {
          // continue with normal failure handling
        }

        if (!options.force) {
          console.error(chalk.red('👻 [Poltergeist] Last build failed'));

          const stateFile = getStateFile(projectRoot, targetName);
          let shouldAutoRebuild = false;

          if (stateFile && existsSync(stateFile)) {
            try {
              const state = JSON.parse(readFileSync(stateFile, 'utf-8'));

              if (state.lastBuildError) {
                const { exitCode, errorOutput, timestamp } = state.lastBuildError;
                const timeAgo = getTimeAgo(new Date(timestamp));
                console.error(chalk.gray(`   Failed ${timeAgo} with exit code ${exitCode}`));

                const errorAge = Date.now() - new Date(timestamp).getTime();
                shouldAutoRebuild = errorAge < 5 * 60 * 1000;

                if (errorOutput && errorOutput.length > 0) {
                  console.error(chalk.red('   Error output:'));
                  errorOutput.slice(-3).forEach((line: string) => {
                    console.error(chalk.gray(`     ${line}`));
                  });
                }
              } else if (state.lastBuild?.errorSummary) {
                console.error(chalk.red(`   Error: ${state.lastBuild.errorSummary}`));
              }
            } catch (_e) {
              // ignore malformed state
            }
          }

          let mightBeStuckBuild = false;
          let stuckBuildType: string | null = null;
          if (stateFile && existsSync(stateFile)) {
            try {
              const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
              if (
                state.lastBuildError?.errorOutput?.some((line: string) => {
                  if (line.includes('Another instance of SwiftPM is already running')) {
                    stuckBuildType = 'SwiftPM';
                    return true;
                  }
                  if (
                    line.includes('another process is already running') ||
                    line.includes('resource temporarily unavailable') ||
                    line.includes('file is locked') ||
                    line.includes('cannot obtain lock')
                  ) {
                    stuckBuildType = 'build process';
                    return true;
                  }
                  return false;
                })
              ) {
                mightBeStuckBuild = true;
              }
            } catch (_e) {
              // ignore
            }
          }

          if (shouldAutoRebuild && !process.env.POLTERGEIST_NO_AUTO_REBUILD) {
            console.log(chalk.yellow('\n🔄 Attempting automatic rebuild...'));

            try {
              const { createBuilder } = await import('../builders/index.js');
              const { createLogger } = await import('../logger.js');
              const { StateManager } = await import('../state.js');

              const logger = createLogger('info');
              const stateManager = new StateManager(projectRoot, logger);
              const builder = createBuilder(target, projectRoot, logger, stateManager);

              const buildStatus = await builder.build([], {
                captureLogs: true,
                logFile: `.poltergeist-auto-rebuild-${targetName}.log`,
              });

              if (buildStatus.status === 'success') {
                console.log(chalk.green('✅ Rebuild successful! Continuing...'));
                break;
              } else {
                console.error(chalk.red('❌ Rebuild failed'));
                console.error(chalk.yellow('\n   Options:'));
                console.error('   • Fix: Edit the code and try again');
                console.error(
                  `   • Details: Run \`poltergeist logs ${targetName}\` for full output`
                );
                console.error('   • Force: Use --force to run anyway');
                process.exit(1);
              }
            } catch (rebuildError) {
              console.error(chalk.red(`❌ Rebuild error: ${rebuildError}`));
              console.error(chalk.yellow('\n   Next steps:'));
              console.error(`   • Fix: Run \`poltergeist build ${targetName}\` manually`);
              console.error('   • Force: Use --force to run anyway');
              process.exit(1);
            }
          } else {
            if (mightBeStuckBuild) {
              console.error(
                chalk.yellow(`\n   ⚠️  Detected stuck ${stuckBuildType || 'build process'}`)
              );
              console.error(chalk.yellow('   Solutions:'));
              if (stuckBuildType === 'SwiftPM') {
                console.error('   • Kill stuck process: killall swift-build');
                console.error('   • Clean build: rm -rf .build && poltergeist build');
              } else {
                console.error('   • Check for stuck processes: ps aux | grep build');
                console.error('   • Kill stuck processes: killall <build-command>');
                console.error('   • Restart Poltergeist: poltergeist stop && poltergeist start');
              }
              console.error('   • Force run anyway: Use --force flag');
            } else {
              console.error(chalk.yellow('\n   Next steps:'));
              console.error(`   • Fix: Run \`poltergeist build ${targetName}\` to rebuild`);
              console.error(`   • Details: Run \`poltergeist logs ${targetName}\` for full output`);
              console.error('   • Force: Use --force to run anyway');
            }
            process.exit(1);
          }
        }
        if (options.force) {
          console.warn(chalk.yellow('⚠️  Running despite build failure (--force specified)'));
        }
        break;
      }

      case 'success':
        if (effectiveVerbose) {
          console.log(chalk.green('👻 [Poltergeist] Build successful'));
        }
        break;

      case 'unknown':
        if (!isSilentTarget && !poltergeistNotRunning) {
          console.warn(chalk.yellow('👻 [Poltergeist] ⚠ Build status unknown, proceeding...'));
        }
        break;
    }

    if (status === 'success' || status === 'poltergeist-not-running' || status === 'failed') {
      warnIfBuildStaleByAge(projectRoot, target.name, 10);
    }

    if (options.watch) {
      await runWithWatchMode({
        target,
        projectRoot,
        args,
        options,
        initialStatus: status,
        poltergeistNotRunning,
      });
      return;
    }

    const exitCode = await executeTarget(target, projectRoot, args, { verbose: effectiveVerbose });
    process.exit(exitCode);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Process exited with code')) {
      // Allow callers that mock process.exit to handle the thrown sentinel error themselves
      throw error;
    }

    console.error(chalk.red('👻 [Poltergeist] Unexpected error:'));
    console.error(chalk.red(`   ${error instanceof Error ? error.message : error}`));

    if (options.verbose && error instanceof Error) {
      console.error(chalk.gray('\nStack trace:'));
      console.error(chalk.gray(error.stack));
    }

    console.error(chalk.yellow('\n   Common solutions:'));
    console.error('   • Check if poltergeist.config.json exists and is valid');
    console.error('   • Verify target name matches configuration');
    console.error('   • Run with --verbose for more details');
    console.error('   • Check poltergeist status: poltergeist status');

    process.exit(1);
  }
}

export { runWrapperWithDefaults };
