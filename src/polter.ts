#!/usr/bin/env node

/**
 * polter - Smart wrapper for running executables managed by Poltergeist
 *
 * Ensures you never run stale or failed builds by:
 * - Checking build status before execution
 * - Waiting for in-progress builds to complete
 * - Failing fast on build errors with clear messages
 * - Executing fresh binaries only when builds succeed
 */

import chalk from 'chalk';
import { execSync, type ChildProcess, spawn } from 'child_process';
import { Command } from 'commander';
import { existsSync, readFileSync, statSync, unwatchFile, watchFile } from 'fs';
import ora from 'ora';
import { resolve as resolvePath } from 'path';
import type { WriteStream } from 'tty';
import { isMainModule } from './utils/paths.js';

// Version is hardcoded at compile time - NEVER read from filesystem
// This ensures the binary always reports its compiled version
const packageJson = { version: '2.1.0', name: '@steipete/poltergeist' };

import {
  configurePolterCommand,
  getPolterDescription,
  type ParsedPolterOptions,
  parsePolterOptions,
  setupPolterErrorHandling,
} from './cli-shared/polter-command.js';
import type { PoltergeistState } from './state.js';
import type { Target } from './types.js';
import { BuildStatusManager } from './utils/build-status-manager.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { FileSystemUtils } from './utils/filesystem.js';
import { poltergeistMessage } from './utils/ghost.js';
import { type LaunchInfo, LaunchPreparationError, prepareLaunchInfo } from './utils/launch.js';

/**
 * Get relative time string (e.g., "2 minutes ago")
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/**
 * Get the state file path for a target
 */
function getStateFile(projectRoot: string, targetName: string): string | null {
  try {
    return FileSystemUtils.getStateFilePath(projectRoot, targetName);
  } catch {
    return null;
  }
}

function resolveBinaryPath(targetName: string, projectRoot: string): string | null {
  const possiblePaths = [
    resolvePath(projectRoot, targetName),
    resolvePath(projectRoot, `./${targetName}`),
    resolvePath(projectRoot, `./build/${targetName}`),
    resolvePath(projectRoot, `./dist/${targetName}`),
    resolvePath(projectRoot, `./${targetName}.js`), // Cross-platform Node.js scripts
    resolvePath(projectRoot, `./build/${targetName}.js`),
    resolvePath(projectRoot, `./dist/${targetName}.js`),
    resolvePath(projectRoot, `./${targetName.replace('-cli', '')}`), // Handle cli suffix
    resolvePath(projectRoot, `./${targetName.replace('-cli', '')}.js`), // Handle cli suffix with .js
    resolvePath(projectRoot, `./${targetName.replace('-app', '')}`), // Handle app suffix
    resolvePath(projectRoot, `./${targetName.replace('-app', '')}.js`), // Handle app suffix with .js
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

async function isBinaryFresh(
  projectRoot: string,
  targetName: string,
  binaryPath: string | null
): Promise<boolean> {
  if (!binaryPath) {
    return false;
  }

  const statePath = getStateFile(projectRoot, targetName);
  if (!statePath || !existsSync(statePath)) {
    return false;
  }

  try {
    const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(statePath);
    if (!state?.lastBuild || !BuildStatusManager.isSuccess(state.lastBuild)) {
      return false;
    }

    const buildTime = new Date(state.lastBuild.timestamp).getTime();
    const binMTime = statSync(binaryPath).mtimeMs;
    if (Number.isNaN(buildTime) || binMTime + 1 < buildTime) {
      return false;
    }

    try {
      const head = execSync('git rev-parse HEAD', { cwd: projectRoot, stdio: 'pipe' })
        .toString()
        .trim();
      if (state.lastBuild.gitHash && head && head !== state.lastBuild.gitHash) {
        return false;
      }

      const status = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' })
        .toString()
        .trim();
      if (status.length > 0) {
        return false;
      }
    } catch {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

interface LogOptions {
  showLogs: boolean;
  logLines: number;
}

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  return normalized !== '0' && normalized !== 'false' && normalized !== 'no';
}

function hasPositiveDimension(value: number | undefined): boolean {
  if (typeof value === 'number') {
    return value > 0;
  }
  return true;
}

function hasRichTTY(): boolean {
  if (envFlagEnabled(process.env.POLTER_FORCE_TTY)) {
    return true;
  }

  if (envFlagEnabled(process.env.POLTER_DISABLE_TTY)) {
    return false;
  }

  const stdout = process.stdout;
  const stderr = process.stderr;

  if (!stdout?.isTTY || !stderr?.isTTY) {
    return false;
  }

  if (envFlagEnabled(process.env.CI)) {
    return false;
  }

  const term = process.env.TERM?.toLowerCase();
  if (!term || term === 'dumb') {
    return false;
  }

  const stdoutStream = stdout as WriteStream;

  if (!hasPositiveDimension(stdoutStream.columns) || !hasPositiveDimension(stdoutStream.rows)) {
    return false;
  }

  if (typeof stdoutStream.getColorDepth === 'function' && stdoutStream.getColorDepth() <= 1) {
    return false;
  }

  return true;
}

/**
 * Read the last N lines from a file
 */
function readLastLines(filePath: string, lines: number): string[] {
  try {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8');
    const allLines = content.trim().split('\n');
    return allLines.slice(-lines);
  } catch (_error) {
    return [];
  }
}

/**
 * Checks if Poltergeist is currently running for this target
 */
function isPoltergeistRunning(state: PoltergeistState | null): boolean {
  if (!state || !state.process) {
    return false;
  }

  // Check if process is marked as active and heartbeat is recent (within last 10 seconds)
  if (state.process.lastHeartbeat) {
    const heartbeatAge = Date.now() - new Date(state.process.lastHeartbeat).getTime();
    // Consider running if heartbeat within 10 seconds AND process is marked active
    return state.process.isActive && heartbeatAge < 10000;
  }

  return false;
}

/**
 * Gets build status for a target by reading state file directly
 */
async function getBuildStatus(
  projectRoot: string,
  target: Target,
  options?: { checkProcessForBuilding?: boolean }
): Promise<'building' | 'failed' | 'success' | 'unknown' | 'poltergeist-not-running'> {
  try {
    const stateFilePath = FileSystemUtils.getStateFilePath(projectRoot, target.name);

    if (!existsSync(stateFilePath)) {
      return 'unknown';
    }

    const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(stateFilePath);

    if (!state) {
      return 'unknown';
    }

    // Check if Poltergeist is running
    if (!isPoltergeistRunning(state)) {
      return 'poltergeist-not-running';
    }

    // Note: state.process is the Poltergeist watcher process, not build process
    // Check the lastBuild status to see if a build is in progress

    // Check build status using BuildStatusManager
    if (state.lastBuild) {
      if (BuildStatusManager.isBuilding(state.lastBuild)) {
        // If build status is 'building' but process is not active and we're checking for waiting,
        // treat as unknown since the build process is likely dead
        if (options?.checkProcessForBuilding && state.process && !state.process.isActive) {
          return 'unknown';
        }
        return 'building';
      }

      if (BuildStatusManager.isFailure(state.lastBuild)) {
        return 'failed';
      }

      if (BuildStatusManager.isSuccess(state.lastBuild)) {
        return 'success';
      }
    }

    return 'unknown';
  } catch (error) {
    console.warn(
      chalk.yellow(
        poltergeistMessage(
          'warning',
          `⚠ Could not read build status: ${error instanceof Error ? error.message : error}`
        )
      )
    );
    return 'unknown';
  }
}

/**
 * Waits for build completion with progress indication
 */
async function waitForBuildCompletion(
  projectRoot: string,
  target: Target,
  timeoutMs = 300000,
  logOptions: LogOptions = { showLogs: true, logLines: 5 }
): Promise<'success' | 'failed' | 'timeout'> {
  const startTime = Date.now();
  const supportsRichTTY = hasRichTTY();
  const shouldStreamLogs = supportsRichTTY && logOptions.showLogs;

  // Use ora for professional spinner with automatic cursor management
  // In non-TTY environments (like tests), ora falls back to just console.log
  const spinner = supportsRichTTY
    ? ora({
        text: 'Build in progress...',
        color: 'cyan',
        spinner: 'dots',
        isEnabled: true,
      })
    : null;

  const reportSuccess = (message: string) => {
    if (spinner) {
      spinner.succeed(message);
    } else {
      console.log(chalk.green(poltergeistMessage('success', message)));
    }
  };

  const reportFailure = (message: string) => {
    if (spinner) {
      spinner.fail(message);
    } else {
      console.error(chalk.red(poltergeistMessage('error', message)));
    }
  };

  // Start spinner (automatically handles TTY detection and cursor hiding)
  if (spinner) {
    spinner.start();
  } else {
    console.log(
      chalk.cyan(
        poltergeistMessage(
          'info',
          '👻 [Poltergeist] Build in progress (non-interactive terminal, waiting quietly)'
        )
      )
    );
    if (logOptions.showLogs && !shouldStreamLogs) {
      console.log(
        chalk.gray(
          poltergeistMessage(
            'info',
            'Log streaming disabled automatically (TTY features unavailable)'
          )
        )
      );
    }
  }

  // Determine log file path using consistent naming
  const logFile = FileSystemUtils.getLogFilePath(projectRoot, target.name);

  // Update elapsed time and build logs periodically
  let timeInterval: NodeJS.Timeout | null = null;
  if (spinner) {
    timeInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (shouldStreamLogs) {
        const logLines = readLastLines(logFile, logOptions.logLines);

        if (logLines.length > 0) {
          const logText = logLines.map((line) => `│ ${line.trim()}`).join('\n');
          spinner.text = `Build in progress... ${Math.round(elapsed / 100) / 10}s\n${logText}`;
        } else {
          spinner.text = `Build in progress... ${Math.round(elapsed / 100) / 10}s`;
        }
      } else {
        spinner.text = `Build in progress... ${Math.round(elapsed / 100) / 10}s`;
      }
    }, 100);
  }

  const clearStatusInterval = () => {
    if (timeInterval) {
      clearInterval(timeInterval);
      timeInterval = null;
    }
  };

  try {
    while (Date.now() - startTime < timeoutMs) {
      const status = await getBuildStatus(projectRoot, target, { checkProcessForBuilding: true });

      if (status === 'success') {
        clearStatusInterval();
        reportSuccess('Build completed successfully');
        return 'success';
      }

      if (status === 'failed') {
        clearStatusInterval();
        reportFailure('Build failed');
        return 'failed';
      }

      if (status !== 'building') {
        // Build process died or status changed - check the actual final status
        const finalStatus = await getBuildStatus(projectRoot, target, {
          checkProcessForBuilding: true,
        });

        clearStatusInterval();

        if (finalStatus === 'success') {
          reportSuccess('Build completed successfully');
          return 'success';
        } else if (finalStatus === 'failed') {
          reportFailure('Build failed');
          return 'failed';
        } else {
          // If status is unknown (e.g., file deleted), assume build process died and proceed
          reportSuccess('Build process completed');
          return 'success';
        }
      }

      // Short sleep to avoid busy polling
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    clearStatusInterval();
    reportFailure('Build timeout');
    return 'timeout';
  } catch (error) {
    clearStatusInterval();
    reportFailure('Build error');
    throw error;
  }
}

interface WatchModeContext {
  target: Target;
  projectRoot: string;
  args: string[];
  options: ParsedPolterOptions;
  initialStatus: string;
  poltergeistNotRunning: boolean;
}

async function runWithWatchMode({
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
      const child = childRef;

      const finalize = () => {
        if (currentChild === child) {
          currentChild = null;
        }
        resolve();
      };

      const forceKillTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);

      const exitHandler = () => {
        clearTimeout(forceKillTimer);
        child.removeListener('error', exitHandler);
        finalize();
      };

      child.once('exit', exitHandler);
      child.once('error', exitHandler);

      if (child.exitCode !== null || child.signalCode) {
        exitHandler();
        return;
      }

      if (!child.kill(signal)) {
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

/**
 * Executes a binary when Poltergeist is not available (stale execution with warning)
 */
async function executeStaleWithWarning(
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
    // Determine how to execute based on file extension
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
      // Assume it's a binary executable
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

      // Provide helpful suggestions based on error type
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

/**
 * Executes the target binary with given arguments
 */
function executeTarget(
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

      // Provide helpful suggestions based on error type
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

/**
 * Shows polter's help message explaining what it does
 */
async function showPolterHelp() {
  // Start with clear explanation of what polter is
  console.log(`${chalk.cyan('👻 Polter')} - Smart execution wrapper for Poltergeist\n`);
  console.log('Ensures you never run stale or failed builds by checking build status first.\n');

  console.log(chalk.bold('USAGE'));
  console.log('  $ polter <target> [args...]\n');

  console.log(chalk.bold('WHAT IT DOES'));
  console.log('  • Checks if target build is fresh and successful');
  console.log('  • Waits for in-progress builds to complete');
  console.log('  • Fails fast on build errors with clear messages');
  console.log("  • Runs the binary only when it's ready\n");

  // Try to load configuration and show available targets
  let hasTargets = false;

  try {
    const discovery = await ConfigurationManager.discoverAndLoadConfig();
    if (discovery) {
      const { config, projectRoot } = discovery;
      const executableTargets = ConfigurationManager.getExecutableTargets(config);

      if (executableTargets.length > 0) {
        hasTargets = true;
        console.log(chalk.bold('AVAILABLE TARGETS'));

        for (const target of executableTargets) {
          const status = await getBuildStatus(projectRoot, target);
          let statusIcon = '';
          let statusText = '';

          switch (status) {
            case 'success':
              statusIcon = chalk.green('✓');
              statusText = chalk.gray(' (ready)');
              break;
            case 'building':
              statusIcon = chalk.yellow('⟳');
              statusText = chalk.yellow(' (building)');
              break;
            case 'failed':
              statusIcon = chalk.red('✗');
              statusText = chalk.red(' (failed)');
              break;
            case 'poltergeist-not-running':
              statusIcon = chalk.gray('○');
              statusText = chalk.gray(' (daemon not running)');
              break;
            default:
              statusIcon = chalk.gray('?');
              statusText = '';
          }

          console.log(`  ${statusIcon} ${chalk.cyan(target.name)}${statusText}`);
        }
        console.log('');

        // Check if Poltergeist is running
        const anyRunning = executableTargets.some((target) => {
          const stateFilePath = FileSystemUtils.getStateFilePath(projectRoot, target.name);
          if (!existsSync(stateFilePath)) return false;
          const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(stateFilePath);
          return isPoltergeistRunning(state);
        });

        if (!anyRunning) {
          console.log(chalk.yellow('⚠  Poltergeist daemon is not running'));
          console.log(`   Start watching: ${chalk.cyan('poltergeist start')}\n`);
        }
      }
    }
  } catch (_error) {
    // Silently handle config errors
  }

  if (hasTargets) {
    console.log(chalk.bold('EXAMPLES'));
    console.log('  $ polter my-app              # Run my-app after ensuring fresh build');
    console.log('  $ polter my-cli --help       # Pass arguments to the target');
    console.log('  $ polter my-app --verbose    # Show build progress while waiting\n');
  } else {
    console.log(chalk.bold('GETTING STARTED'));
    console.log('  1. Create a poltergeist.config.json with executable targets');
    console.log('  2. Run: poltergeist start    # Start the build daemon');
    console.log('  3. Use: polter <target>      # Run your executables safely\n');
  }

  console.log(chalk.bold('OPTIONS'));
  console.log('  -t, --timeout <ms>    Build wait timeout (default: 300s)');
  console.log('  -f, --force           Run even if build failed');
  console.log("  -n, --no-wait         Don't wait for builds");
  console.log('  --verbose             Show detailed status info');
  console.log('  --no-logs             Disable build log streaming');
  console.log('  -v, --version         Show version');
  console.log('  -h, --help            Show this help\n');

  console.log(chalk.gray("For daemon control (start/stop/status), use 'poltergeist' instead."));
}

/**
 * Wrapper that handles default target selection
 */
async function runWrapperWithDefaults(
  targetName: string | undefined,
  args: string[],
  options: ParsedPolterOptions
) {
  // If help flag is set or no target specified, show help
  if (options.help || !targetName) {
    await showPolterHelp();
    process.exit(0);
  }

  await runWrapper(targetName, args, options);
}

/**
 * Main pgrun execution logic
 */
export async function runWrapper(targetName: string, args: string[], options: ParsedPolterOptions) {
  // Special handling for peekaboo - suppress all non-error output for complete transparency
  const isSilentTarget = targetName === 'peekaboo';
  const effectiveVerbose = isSilentTarget ? false : options.verbose;
  let poltergeistNotRunning = false;

  try {
    // Find poltergeist config
    const discovery = await ConfigurationManager.discoverAndLoadConfig();
    if (!discovery) {
      // No Poltergeist config found - fall back to stale execution
      if (options.verbose) {
        console.warn(
          chalk.yellow(
            '👻 [Poltergeist] ⚠ No poltergeist.config.json found - attempting stale execution'
          )
        );
      }

      // Try to find project root (current directory)
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

    // Find target
    const target = ConfigurationManager.findTarget(config, targetName);
    if (!target) {
      // Target not found in config - try stale execution fallback
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

      // When target is not in config, use current directory for stale execution
      // This allows running arbitrary binaries from the current directory
      const staleExecutionRoot = process.cwd();
      const exitCode = await executeStaleWithWarning(targetName, staleExecutionRoot, args, options);
      process.exit(exitCode);
    }

    // Validate target type
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

    // Check build status
    const status = await getBuildStatus(projectRoot, target);

    if (effectiveVerbose) {
      console.log(chalk.gray(`👻 [Poltergeist] Build status: ${status}`));
    }

    // Check if Poltergeist is not running
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
          console.warn(chalk.yellow('   npm run poltergeist:haunt'));
          console.warn('');
        }
      }
    }

    // Handle different build states
    switch (status) {
      case 'poltergeist-not-running':
        // Already handled warning above, proceed with execution
        break;
      case 'building': {
        // Build is marked as in progress - but verify with lock
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
        // Always check if there's a lock file regardless of the error type
        // This handles any stuck build scenario, not just SwiftPM
        try {
          const { StateManager } = await import('./state.js');
          const { createLogger } = await import('./logger.js');
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
              // Build completed successfully, continue execution
              break;
            } else if (result === 'timeout') {
              console.error(
                chalk.yellow('👻 [Poltergeist] Build appears stuck (lock present but no progress)')
              );
              console.error(chalk.yellow('   Solutions:'));
              console.error('   • Check for stuck build processes: ps aux | grep build');
              console.error('   • Clear the lock: poltergeist stop && poltergeist start');
              console.error('   • Force run anyway: Use --force flag');
              // Don't exit yet, let it fall through to show error details
            }
            // Fall through to show build failure details
          }
        } catch (_e) {
          // If we can't check the lock, continue with normal failed handling
        }

        if (!options.force) {
          console.error(chalk.red('👻 [Poltergeist] Last build failed'));

          // Try to get error details from state
          const stateFile = getStateFile(projectRoot, targetName);
          let shouldAutoRebuild = false;

          if (stateFile && existsSync(stateFile)) {
            try {
              const state = JSON.parse(readFileSync(stateFile, 'utf-8'));

              // Show inline error if available
              if (state.lastBuildError) {
                const { exitCode, errorOutput, timestamp } = state.lastBuildError;
                const timeAgo = getTimeAgo(new Date(timestamp));
                console.error(chalk.gray(`   Failed ${timeAgo} with exit code ${exitCode}`));

                // Check if error is recent (within 5 minutes) for auto-rebuild
                const errorAge = Date.now() - new Date(timestamp).getTime();
                shouldAutoRebuild = errorAge < 5 * 60 * 1000; // 5 minutes

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
              // Silently continue if we can't read state
            }
          }

          // Check if there might be a stuck build process based on common patterns
          let mightBeStuckBuild = false;
          let stuckBuildType: string | null = null;
          if (stateFile && existsSync(stateFile)) {
            try {
              const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
              // Check for various stuck build patterns
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
              // Ignore
            }
          }

          // Automatic rebuild attempt for recent failures
          if (shouldAutoRebuild && !process.env.POLTERGEIST_NO_AUTO_REBUILD) {
            console.log(chalk.yellow('\n🔄 Attempting automatic rebuild...'));

            try {
              const { createBuilder } = await import('./builders/index.js');
              const { createLogger } = await import('./logger.js');
              const { StateManager } = await import('./state.js');

              const logger = createLogger('info');
              const stateManager = new StateManager(projectRoot, logger);
              const builder = createBuilder(target, projectRoot, logger, stateManager);

              const buildStatus = await builder.build([], {
                captureLogs: true,
                logFile: `.poltergeist-auto-rebuild-${targetName}.log`,
              });

              if (buildStatus.status === 'success') {
                console.log(chalk.green('✅ Rebuild successful! Continuing...'));
                // Continue with execution - don't exit, proceed to execution
                break;
              } else {
                console.error(chalk.red('❌ Rebuild failed'));
                console.error(chalk.yellow('\n   Options:'));
                console.error(`   • Fix: Edit the code and try again`);
                console.error(
                  `   • Details: Run \`poltergeist logs ${targetName}\` for full output`
                );
                console.error(`   • Force: Use --force to run anyway`);
                process.exit(1);
              }
            } catch (rebuildError) {
              console.error(chalk.red(`❌ Rebuild error: ${rebuildError}`));
              console.error(chalk.yellow('\n   Next steps:'));
              console.error(`   • Fix: Run \`poltergeist build ${targetName}\` manually`);
              console.error(`   • Force: Use --force to run anyway`);
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
              console.error(`   • Force: Use --force to run anyway`);
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

    // Execute the target once
    const exitCode = await executeTarget(target, projectRoot, args, { verbose: effectiveVerbose });
    process.exit(exitCode);
  } catch (error) {
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

// Only run CLI setup if this file is being executed directly (not imported)
// Check if the file is being executed as a script (not imported as a module)
// This works whether run directly, via symlink, or as a global npm package
if (
  process.argv[1] &&
  (isMainModule() ||
    process.argv[1].endsWith('/polter') ||
    process.argv[1].endsWith('/polter.js') ||
    process.argv[1].endsWith('/polter.ts') ||
    process.argv[1].endsWith('\\polter.js') ||
    process.argv[1].endsWith('\\polter.ts'))
) {
  // CLI setup
  const program = new Command();

  const polterCommand = program
    .name('polter')
    .description(getPolterDescription())
    .version(packageJson.version, '-v, --version', 'output the version number')
    .argument('[target]', 'Name of the target to run')
    .argument('[args...]', 'Arguments to pass to the target executable')
    .helpOption(false) // Disable default help to handle it ourselves
    .option('-h, --help', 'Show help for polter');

  // Configure with shared options
  configurePolterCommand(polterCommand);

  polterCommand.action(async (target: string | undefined, args: string[], options) => {
    const parsedOptions = parsePolterOptions(options);
    await runWrapperWithDefaults(target, args, parsedOptions);
  });

  // Setup shared error handling
  setupPolterErrorHandling();

  // Parse CLI arguments
  program.parse();
}
