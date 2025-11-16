import chalk from 'chalk';
import type { Command } from 'commander';
import { createPoltergeist } from '../../factories.js';
import { createLogger } from '../../logger.js';
import { runStatusPanel } from '../../panel/run-panel.js';
import type { StatusObject } from '../../status/types.js';
import type { PoltergeistConfig } from '../../types.js';
import { DEFAULT_LOG_CHANNEL, sanitizeLogChannel } from '../../utils/log-channels.js';
import { displayLogs } from '../logging.js';
import { formatTargetStatus } from '../status-formatters.js';
import { exitWithError, loadConfigOrExit, parseGitModeOrExit } from '../shared.js';
import { ghost, poltergeistMessage } from '../../utils/ghost.js';
import { validateTarget } from '../../utils/target-validator.js';
import { resolveLogPath } from '../log-path-resolver.js';

export const registerStatusCommands = (program: Command): void => {
  program
    .command('panel')
    .description('Open the interactive status panel')
    .option('-c, --config <path>', 'Path to config file')
    .option('--verbose', 'Enable verbose logging (same as --log-level debug)')
    .option('--git-mode <mode>', 'Git summary mode (ai | list)', 'ai')
    .action(async (options) => {
      const { config, projectRoot, configPath } = await loadConfigOrExit(options.config);
      const logger = createLogger(options.verbose ? 'debug' : config.logging?.level || 'info');
      const gitSummaryMode = parseGitModeOrExit(options.gitMode);
      await runStatusPanel({
        config,
        projectRoot,
        configPath,
        logger,
        gitSummaryMode,
      });
    });

  program
    .command('status [view]')
    .description('Check Poltergeist status')
    .option('-t, --target <name>', 'Check specific target status')
    .option('-c, --config <path>', 'Path to config file')
    .option('--verbose', 'Show detailed status information')
    .option('--json', 'Output status as JSON')
    .option('--git-mode <mode>', 'Git summary mode (ai | list)', 'ai')
    .action(async (view: string | undefined, options) => {
      const { config, projectRoot, configPath } = await loadConfigOrExit(options.config);

      try {
        const logger = createLogger(config.logging?.level || 'info');

        if (view === 'panel') {
          if (options.json) {
            exitWithError('--json is not compatible with the panel view.');
          }
          const gitSummaryMode = parseGitModeOrExit(options.gitMode);

          await runStatusPanel({
            config,
            projectRoot,
            configPath,
            logger,
            gitSummaryMode,
          });
          return;
        }

        const effectiveTarget = options.target ?? (view && view !== 'panel' ? view : undefined);
        const poltergeist = createPoltergeist(config, projectRoot, logger, configPath);
        const status = await poltergeist.getStatus(effectiveTarget);

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(chalk.cyan(`${ghost.brand()} Poltergeist Status`));
          console.log(chalk.gray('═'.repeat(50)));

          if (effectiveTarget) {
            const targetStatus = status[effectiveTarget];
            if (!targetStatus) {
              console.log(chalk.yellow(`Target '${effectiveTarget}' not found`));
            } else {
              formatTargetStatus(effectiveTarget, targetStatus, options.verbose);
            }
          } else {
            const targets = Object.keys(status).filter((key) => !key.startsWith('_'));
            if (targets.length === 0) {
              console.log(chalk.gray('No targets configured'));
            } else {
              targets.forEach((name) => {
                formatTargetStatus(name, status[name], options.verbose);
                console.log();
              });
            }

            console.log(chalk.gray('Tip: run "poltergeist status panel" to open the live dashboard.'));
          }
        }
      } catch (error) {
        exitWithError(poltergeistMessage('error', `Failed to get status: ${error}`));
      }
    });

  program
    .command('logs [target]')
    .description('Show Poltergeist logs')
    .option('-t, --tail <number>', 'Number of lines to show (default: 100)')
    .option('-f, --follow', 'Follow log output')
    .option('-c, --config <path>', 'Path to config file')
    .option('-C, --channel <name>', 'Log channel to display (default: build)')
    .option('--json', 'Output logs in JSON format')
    .action(async (targetName, options) => {
      const { config, projectRoot } = await loadConfigOrExit(options.config);

      await showLogs(config, projectRoot, targetName, options);
    });

  program
    .command('wait [target]')
    .description('Wait for a build to complete')
    .option('-t, --timeout <seconds>', 'Maximum time to wait in seconds', '300')
    .option('-c, --config <path>', 'Path to config file')
    .option('--json', 'Output result as JSON')
    .action(async (targetName, options) => {
      const { config, projectRoot } = await loadConfigOrExit(options.config);
      const logger = createLogger(config.logging?.level || 'info');
      const poltergeist = createPoltergeist(config, projectRoot, logger, options.config || '');

      try {
        const status = await poltergeist.getStatus();

        const activeBuilds = Object.entries(status)
          .filter(
            ([name, s]) => !name.startsWith('_') && (s as StatusObject).lastBuild?.status === 'building'
          )
          .map(([name, s]) => ({ name, status: s as StatusObject }));

        let targetToWait: string | undefined;
        let targetStatus: StatusObject | undefined;

        if (targetName) {
          validateTarget(targetName, config);

          const statusObj = status[targetName] as StatusObject;
          if (statusObj.lastBuild?.status !== 'building') {
            console.log(chalk.yellow(`Target '${targetName}' is not currently building`));
            exitWithError(`Target '${targetName}' is not currently building`, 0);
          }
          targetToWait = targetName;
          targetStatus = statusObj;
        } else if (activeBuilds.length === 0) {
          console.log(chalk.yellow('No builds currently active'));
          return;
        } else if (activeBuilds.length === 1) {
          targetToWait = activeBuilds[0].name;
          targetStatus = activeBuilds[0].status;
        } else {
          const list = activeBuilds
            .map(({ name, status }) => {
              const buildCommand = status.buildCommand || 'build command unknown';
              return `   ${chalk.cyan(name)}: ${chalk.gray(buildCommand)}`;
            })
            .join('\n');
          exitWithError(
            `❌ Multiple targets building. Please specify:\n${list}\n   Usage: poltergeist wait <target>`
          );
        }

        if (!targetToWait || !targetStatus) {
          exitWithError('No target selected to wait for.');
        }
        const resolvedTarget = targetToWait as string;
        const resolvedStatus = targetStatus as StatusObject;

        const isJson = Boolean(options.json);

        if (!process.stdout.isTTY && !isJson) {
          console.log(`⏳ Waiting for '${resolvedTarget}' build...`);
          if (resolvedStatus.buildCommand) {
            console.log(`Command: ${resolvedStatus.buildCommand}`);
          }

          if (resolvedStatus.lastBuild?.timestamp) {
            const elapsed = Date.now() - new Date(resolvedStatus.lastBuild.timestamp).getTime();
            const elapsedSec = Math.round(elapsed / 1000);

            if (resolvedStatus.buildStats?.averageDuration) {
              const avgSec = Math.round(resolvedStatus.buildStats.averageDuration / 1000);
              const remaining = Math.max(0, avgSec - elapsedSec);
              console.log(`Started: ${elapsedSec}s ago, ~${remaining}s remaining`);
            } else {
              console.log(`Started: ${elapsedSec}s ago`);
            }
          }
        } else {
          console.log(chalk.blue(`⏳ Waiting for '${resolvedTarget}' to complete...`));
        }

        const timeout = Number.parseInt(options.timeout, 10) * 1000;
        const pollInterval = 1000;
        const startTime = Date.now();

        while (true) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));

          if (Date.now() - startTime > timeout) {
            exitWithError('❌ Build failed\nError: Timeout exceeded');
          }

          const updatedStatus = await poltergeist.getStatus(resolvedTarget);
          const targetUpdate = updatedStatus[resolvedTarget] as StatusObject;

          if (!targetUpdate) {
            exitWithError('❌ Build failed\nError: Target disappeared');
          }

          const buildStatus = targetUpdate.lastBuild?.status;

          if (buildStatus === 'success') {
            const durationMs = targetUpdate.lastBuild?.duration;
            if (isJson) {
              console.log(
                JSON.stringify(
                  {
                    target: resolvedTarget,
                    status: 'success',
                    durationMs,
                    startedAt: resolvedStatus.lastBuild?.timestamp,
                    finishedAt: targetUpdate.lastBuild?.timestamp,
                  },
                  null,
                  2
                )
              );
            } else if (!process.stdout.isTTY) {
              console.log('✅ Build completed successfully');
              if (durationMs) {
                const durSec = Math.round(durationMs / 1000);
                console.log(`Duration: ${durSec}s`);
              }
            } else {
              console.log(chalk.green('✅ Build completed successfully'));
            }
            return;
          } else if (buildStatus === 'failure') {
            const summary = targetUpdate.lastBuild?.errorSummary
              ? `\nError: ${targetUpdate.lastBuild.errorSummary}`
              : '';
            if (isJson) {
              console.log(
                JSON.stringify(
                  {
                    target: resolvedTarget,
                    status: 'failure',
                    error: targetUpdate.lastBuild?.errorSummary ?? 'unknown',
                    startedAt: resolvedStatus.lastBuild?.timestamp,
                    finishedAt: targetUpdate.lastBuild?.timestamp,
                  },
                  null,
                  2
                )
              );
            }
            exitWithError(`❌ Build failed${summary}`);
          } else if (buildStatus !== 'building') {
            const summary =
              buildStatus === undefined ? 'unknown' : `Build ended with status: ${buildStatus}`;
            if (isJson) {
              console.log(
                JSON.stringify(
                  {
                    target: resolvedTarget,
                    status: buildStatus ?? 'unknown',
                    startedAt: resolvedStatus.lastBuild?.timestamp,
                    finishedAt: targetUpdate.lastBuild?.timestamp,
                  },
                  null,
                  2
                )
              );
            }
            exitWithError(`❌ Build failed\nError: ${summary}`);
          }
          // Continue polling if still building
        }
      } catch (error) {
        exitWithError(`Failed to wait: ${error}`);
      }
    });
};

async function showLogs(
  config: PoltergeistConfig,
  projectRoot: string,
  targetName: string | undefined,
  options: { channel?: string; config?: string; tail?: string; follow?: boolean; json?: boolean }
): Promise<void> {
  const logChannel = sanitizeLogChannel(options.channel ?? DEFAULT_LOG_CHANNEL);

  const resolved = resolveLogPath({
    channel: logChannel,
    config,
    projectRoot,
    targetName: targetName ?? (process.env.VITEST ? config.targets[0]?.name : undefined),
  });

  if (!resolved.logFile) {
    exitWithError(
      `No log file found for target: ${resolved.target ?? 'unknown'}\n💡 Start Poltergeist to generate logs: poltergeist start`
    );
  }

  try {
    const lines = options.tail || '100';
    await displayLogs(resolved.logFile as string, {
      target: resolved.target,
      lines,
      follow: options.follow,
      json: options.json,
    });
  } catch (error) {
    exitWithError(`Failed to read logs: ${error instanceof Error ? error.message : error}`);
  }
}
