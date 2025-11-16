import chalk from 'chalk';
import { existsSync } from 'fs';
import ora from 'ora';

import type { PoltergeistState } from '../state.js';
import type { Target } from '../types.js';
import { BuildStatusManager } from '../utils/build-status-manager.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import { poltergeistMessage } from '../utils/ghost.js';
import { readLastLines } from './logs.js';
import { hasRichTTY } from './terminal.js';

export function getStateFile(projectRoot: string, targetName: string): string | null {
  try {
    return FileSystemUtils.getStateFilePath(projectRoot, targetName);
  } catch {
    return null;
  }
}

export function isPoltergeistRunning(state: PoltergeistState | null): boolean {
  if (!state || !state.process) {
    return false;
  }

  // Check if process is marked as active and heartbeat is recent (within last 10 seconds)
  if (state.process.lastHeartbeat) {
    const heartbeatAge = Date.now() - new Date(state.process.lastHeartbeat).getTime();
    return state.process.isActive && heartbeatAge < 10_000;
  }

  return false;
}

export async function getBuildStatus(
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

    if (!isPoltergeistRunning(state)) {
      return 'poltergeist-not-running';
    }

    if (state.lastBuild) {
      if (BuildStatusManager.isBuilding(state.lastBuild)) {
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

export function warnIfBuildStaleByAge(
  projectRoot: string,
  targetName: string,
  maxAgeMinutes = 10
): void {
  const statePath = getStateFile(projectRoot, targetName);
  if (!statePath || !existsSync(statePath)) return;

  try {
    const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(statePath);
    if (!state) return;
    const ts = state.lastBuild?.timestamp;
    if (!ts) return;

    const ageMs = Date.now() - new Date(ts).getTime();
    if (Number.isNaN(ageMs)) return;

    const threshold = maxAgeMinutes * 60_000;
    if (ageMs > threshold) {
      const ageMinutes = Math.floor(ageMs / 60_000);
      const formatted = new Date(ts).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      console.warn(
        chalk.yellow(
          poltergeistMessage(
            'warning',
            `Build is ${ageMinutes}m old (last build ${formatted}); consider rebuilding.`
          )
        )
      );
    }
  } catch {
    // If stale warning fails, continue without blocking execution
  }
}

export async function waitForBuildCompletion(
  projectRoot: string,
  target: Target,
  timeoutMs = 300_000,
  logOptions: { showLogs: boolean; logLines: number } = { showLogs: true, logLines: 5 }
): Promise<'success' | 'failed' | 'timeout'> {
  const startTime = Date.now();
  const supportsRichTTY = hasRichTTY();
  const shouldStreamLogs = supportsRichTTY && logOptions.showLogs;

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

  const logFile = FileSystemUtils.getLogFilePath(projectRoot, target.name);

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
          reportSuccess('Build process completed');
          return 'success';
        }
      }

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
