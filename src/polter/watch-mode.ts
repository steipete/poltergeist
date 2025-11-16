import chalk from 'chalk';
import { type ChildProcess, spawn } from 'child_process';
import { unwatchFile, watchFile } from 'fs';
import type { ParsedPolterOptions } from '../cli-shared/polter-command.js';
import type { PoltergeistState } from '../state.js';
import type { Target } from '../types.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import { poltergeistMessage } from '../utils/ghost.js';
import { type LaunchInfo, LaunchPreparationError, prepareLaunchInfo } from '../utils/launch.js';
import { getStateFile } from './build-status.js';

interface WatchModeContext {
  target: Target;
  projectRoot: string;
  args: string[];
  options: ParsedPolterOptions;
  initialStatus: string;
  poltergeistNotRunning: boolean;
}

export async function runWithWatchMode({
  target,
  projectRoot,
  args,
  options,
  initialStatus,
  poltergeistNotRunning,
}: WatchModeContext): Promise<void> {
  if (poltergeistNotRunning) {
    console.warn(
      chalk.yellow(
        '👻 [Poltergeist] Daemon not detected — watch mode will restart once fresh builds appear.'
      )
    );
  }

  if (initialStatus !== 'success') {
    console.warn(
      chalk.yellow(
        '👻 [Poltergeist] Running latest available binary. Waiting for a successful rebuild to restart automatically.'
      )
    );
  }

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
      process.exit(1);
    }
    throw error;
  }

  console.log(
    chalk.cyan(
      '👻 [Poltergeist] Watch mode enabled — the process will restart after each successful rebuild.'
    )
  );

  const stateFilePath = getStateFile(projectRoot, target.name);
  if (!stateFilePath) {
    console.error(
      chalk.red(
        poltergeistMessage(
          'error',
          'Unable to locate Poltergeist state file. Ensure the daemon is running for this project.'
        )
      )
    );
    process.exit(1);
  }

  let lastSuccessTimestamp = '';
  const initialState = FileSystemUtils.readJsonFileStrict<PoltergeistState>(stateFilePath);
  if (initialState?.lastBuild?.timestamp && initialState.lastBuild.status === 'success') {
    lastSuccessTimestamp = initialState.lastBuild.timestamp;
  }

  let currentChild: ChildProcess | null = null;
  let shuttingDown = false;
  let pendingRestart = false;
  let restartTimer: NodeJS.Timeout | null = null;

  const startChild = (reason: string) => {
    try {
      if (options.verbose) {
        console.log(chalk.gray(`👻 [Poltergeist] Launching process (${reason})`));
      }
      currentChild = spawn(launchInfo.command, launchInfo.commandArgs, {
        stdio: 'inherit',
        cwd: projectRoot,
      });

      currentChild.on('exit', (code, signal) => {
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
          pendingRestart = false;
        }
        if (!shuttingDown) {
          const status = signal ? `signal ${signal}` : `code ${code}`;
          console.log(
            chalk.gray(
              `👻 [Poltergeist] Process exited with ${status}. Waiting for next successful build...`
            )
          );
        }
        currentChild = null;
      });

      currentChild.on('error', (error: Error) => {
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
      });
    } catch (error) {
      console.error(
        chalk.red(poltergeistMessage('error', `Failed to launch ${target.name}: ${error}`))
      );
    }
  };

  const stopChild = (signal: NodeJS.Signals): Promise<void> => {
    if (!currentChild) {
      return Promise.resolve();
    }

    const childRef = currentChild as ChildProcess;
    return new Promise((resolve) => {
      const finalize = () => {
        currentChild = null;
        resolve();
      };

      const forceKillTimer = setTimeout(() => {
        console.warn(chalk.yellow('👻 [Poltergeist] Forcing child process termination'));
        childRef.kill('SIGKILL');
      }, 5000);

      const exitHandler = () => {
        clearTimeout(forceKillTimer);
        childRef.removeListener('error', exitHandler);
        finalize();
      };

      childRef.once('exit', exitHandler);
      childRef.once('error', exitHandler);

      if (childRef.exitCode !== null || childRef.signalCode) {
        exitHandler();
        return;
      }

      if (!childRef.kill(signal)) {
        exitHandler();
      }
    });
  };

  const performRestart = async () => {
    pendingRestart = false;
    restartTimer = null;
    try {
      const refreshedLaunchInfo = prepareLaunchInfo(target, projectRoot, args);
      await stopChild(options.restartSignal);
      launchInfo = refreshedLaunchInfo;
      startChild('rebuild');
    } catch (error) {
      if (error instanceof LaunchPreparationError) {
        if (error.code === 'BINARY_NOT_FOUND') {
          console.error(
            chalk.red(
              poltergeistMessage(
                'error',
                `Binary not found after rebuild: ${error.binaryPath ?? '<unknown>'}`
              )
            )
          );
          console.error(
            chalk.yellow('   Build may have failed. Check `poltergeist logs` for details.')
          );
        } else {
          console.error(
            chalk.red(
              poltergeistMessage(
                'error',
                `Target '${error.targetName}' no longer has an output path. Aborting restart.`
              )
            )
          );
        }
      } else {
        console.error(chalk.red(poltergeistMessage('error', `Failed to restart: ${error}`)));
      }
    }
  };

  const scheduleRestart = () => {
    if (pendingRestart) {
      return;
    }
    pendingRestart = true;
    if (options.verbose) {
      console.log(chalk.gray('👻 [Poltergeist] Scheduling restart after successful build'));
    }
    restartTimer = setTimeout(performRestart, Math.max(0, options.restartDelay));
  };

  const handleStateChange = () => {
    const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(stateFilePath);
    if (!state?.lastBuild) {
      return;
    }
    if (state.lastBuild.status !== 'success') {
      if (options.verbose) {
        console.log(
          chalk.gray(
            `👻 [Poltergeist] Build status update (${state.lastBuild.status}) — not restarting`
          )
        );
      }
      return;
    }
    const timestamp = state.lastBuild.timestamp;
    if (!timestamp || timestamp === lastSuccessTimestamp) {
      return;
    }
    lastSuccessTimestamp = timestamp;
    scheduleRestart();
  };

  const watcher = () => {
    handleStateChange();
  };

  watchFile(stateFilePath, { interval: Math.max(200, options.restartDelay) }, watcher);

  const cleanup = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    unwatchFile(stateFilePath, watcher);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    await stopChild(signal);
    console.log(chalk.gray('👻 [Poltergeist] Watch mode stopped.'));
    process.exit(0);
  };

  const onSigint = () => {
    void cleanup('SIGINT');
  };
  const onSigterm = () => {
    void cleanup('SIGTERM');
  };

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  if (options.verbose) {
    console.log(chalk.gray(`👻 [Poltergeist] Watching state file: ${stateFilePath}`));
  }

  startChild('initial');

  await new Promise<void>(() => {
    // Keep process alive; cleanup will exit explicitly.
  });
}
