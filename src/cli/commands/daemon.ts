import { appendFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { createPoltergeist } from '../../factories.js';
import { createLogger } from '../../logger.js';
import { ConfigurationManager } from '../../utils/config-manager.js';
import { ghost, poltergeistMessage } from '../../utils/ghost.js';
import { printBuildLockHints } from '../status-formatters.js';
import { validateTarget } from '../../utils/target-validator.js';
import { loadConfigOrExit, exitWithError } from '../shared.js';
import { createBuilderForTarget, instantiateStateManager, loadDaemonManager } from '../loaders.js';
import { applyConfigOption, applyLogLevelOptions, applyTargetOption } from '../options.js';
import type { Target } from '../../types.js';

export const registerDaemonCommands = (program: Command): void => {
  const haunt = program
    .command('haunt')
    .alias('start')
    .description('Start watching and auto-building your project (spawns a daemon and returns immediately)')
    .option('-f, --foreground', 'Run in foreground (blocking mode)')
    .action(async (options) => {
      const { config, projectRoot, configPath } = await loadConfigOrExit(options.config);

      let noEnabledTargets = false;
      const noTargetsMessage = 'No enabled targets found. Daemon will continue running.';

      if (options.target) {
        validateTarget(options.target, config);
      } else {
        const enabledTargets = config.targets.filter((t) => t.enabled);
        if (enabledTargets.length === 0) {
          console.log(chalk.yellow('⚠️ No enabled targets found in configuration'));
          console.log(
            chalk.dim(
              '💡 Daemon will continue running. You can enable targets by editing poltergeist.config.json'
            )
          );
          noEnabledTargets = true;
        }
      }

      const logLevel = options.logLevel || (options.verbose ? 'debug' : config.logging?.level || 'info');

      const logger = createLogger(config.logging?.file || '.poltergeist.log', logLevel);
      const flushLoggerIfPossible = () => {
        if (typeof (logger as any).flush === 'function') {
          try {
            (logger as any).flush();
          } catch {
            // Ignore flush errors; logger is best-effort
          }
        }
      };

      const resolvedLogPath = config.logging?.file
        ? path.isAbsolute(config.logging.file)
          ? config.logging.file
          : path.join(projectRoot, config.logging.file)
        : path.join(projectRoot, '.poltergeist.log');

      const appendWarningToLog = () => {
        try {
          appendFileSync(
            resolvedLogPath,
            `${new Date().toISOString()} WARN : ${noTargetsMessage}\n`,
            'utf-8'
          );
          if (process.env.POLTERGEIST_DEBUG_LOGGER === 'true') {
            console.log(`Appended warning to ${resolvedLogPath}`);
          }
        } catch {
          // Swallow logging errors; console warning already shown.
        }
      };

      if (noEnabledTargets && options.foreground) {
        logger.warn(noTargetsMessage);
        appendWarningToLog();
      }

      if (!options.foreground) {
        const isTestMode = process.env.POLTERGEIST_TEST_MODE === 'true';

        try {
          if (isTestMode) {
            console.log(chalk.gray(poltergeistMessage('info', 'Starting daemon...')));
            console.log(chalk.green(`${ghost.success()} Poltergeist daemon started (PID: test-mode)`));
            console.log(chalk.gray('Use "poltergeist logs" to see output'));
            console.log(chalk.gray('Use "poltergeist status" to check build status'));
            console.log(chalk.gray('Use "poltergeist stop" to stop watching'));
            return;
          }

          const { DaemonManager } = await loadDaemonManager();
          const daemon = new DaemonManager(logger);

          if (await daemon.isDaemonRunning(projectRoot)) {
            console.log(
              chalk.yellow(`${ghost.warning()} Poltergeist daemon is already running for this project`)
            );
            console.log(chalk.gray('Use "poltergeist status" to see details'));
            console.log(chalk.gray('Use "poltergeist stop" to stop the daemon'));
            flushLoggerIfPossible();
            exitWithError('Daemon already running');
          }

          console.log(chalk.gray(poltergeistMessage('info', 'Starting daemon...')));

          const pid = await daemon.startDaemonWithRetry(config, {
            projectRoot,
            configPath,
            target: options.target,
            verbose: options.verbose,
            logLevel: options.logLevel,
          });

          if (noEnabledTargets) {
            if (process.env.POLTERGEIST_DEBUG_LOGGER === 'true') {
              console.log('noEnabledTargets true, writing warning');
            }
            logger.warn(noTargetsMessage);
            appendWarningToLog();
          }

          console.log(chalk.green(`${ghost.success()} Poltergeist daemon started (PID: ${pid})`));
          console.log(
            chalk.gray(
              'Initial builds continue in the background; use "poltergeist logs" to follow progress'
            )
          );
          console.log(chalk.gray('Use "poltergeist status" to check build status'));
          console.log(chalk.gray('Use "poltergeist stop" to stop watching'));
          flushLoggerIfPossible();
        } catch (error) {
          exitWithError(poltergeistMessage('error', `Failed to start daemon: ${error}`));
          flushLoggerIfPossible();
        }
      } else {
        console.log(chalk.gray(poltergeistMessage('info', 'Running in foreground mode...')));

        if (options.target) {
          console.log(chalk.gray(poltergeistMessage('info', `Building target: ${options.target}`)));
        } else {
          const enabledTargets = config.targets.filter((t) => t.enabled);
          console.log(
            chalk.gray(poltergeistMessage('info', `Building ${enabledTargets.length} enabled target(s)`))
          );
        }

        try {
          const poltergeist = createPoltergeist(config, projectRoot, logger, configPath);
          await poltergeist.start(options.target);
        } catch (error) {
          exitWithError(poltergeistMessage('error', `Failed to start Poltergeist: ${error}`));
          flushLoggerIfPossible();
        }

        flushLoggerIfPossible();
      }
    });

  applyTargetOption(haunt);
  applyConfigOption(haunt);
  applyLogLevelOptions(haunt);

  const stopCmd = program
    .command('stop')
    .alias('rest')
    .description('Stop Poltergeist daemon')
    .action(async (options) => {
      const { config, projectRoot } = await loadConfigOrExit(options.config);
      const logger = createLogger(config.logging?.level || 'info');
      const isTestMode = process.env.POLTERGEIST_TEST_MODE === 'true';
      if (isTestMode) {
        const pretendRunning = process.env.POLTERGEIST_TEST_DAEMON_RUNNING === 'true';
        if (!pretendRunning) {
          exitWithError(`${ghost.warning()} No Poltergeist daemon running for this project`, 1);
        }

        console.log(chalk.gray(poltergeistMessage('info', 'Stopping daemon...')));
        const simulatedError = process.env.POLTERGEIST_TEST_STOP_ERROR;
        if (simulatedError) {
          exitWithError(poltergeistMessage('error', `Failed to stop daemon: ${simulatedError}`));
        }
        console.log(chalk.green(poltergeistMessage('success', 'Daemon stopped successfully')));
        return;
      }

      try {
        const { DaemonManager } = await loadDaemonManager();
        const daemon = new DaemonManager(logger);

        if (!(await daemon.isDaemonRunning(projectRoot))) {
          console.log(chalk.yellow(`${ghost.warning()} No Poltergeist daemon running for this project`));
          exitWithError('No daemon running');
        }

        console.log(chalk.gray(poltergeistMessage('info', 'Stopping daemon...')));
        await daemon.stopDaemon(projectRoot);
        console.log(chalk.green(poltergeistMessage('success', 'Daemon stopped successfully')));
      } catch (error) {
        exitWithError(poltergeistMessage('error', `Failed to stop daemon: ${error}`));
      }
    });

  applyConfigOption(stopCmd);

  const restartCmd = program
    .command('restart')
    .description('Restart Poltergeist daemon')
    .option('-f, --foreground', 'Restart in foreground mode')
    .action(async (options) => {
      console.log(chalk.gray(poltergeistMessage('info', 'Restarting...')));

      const { config, projectRoot, configPath } = await loadConfigOrExit(options.config);
      const logger = createLogger(config.logging?.level || 'info');

      try {
        const { DaemonManager } = await loadDaemonManager();
        const daemon = new DaemonManager(logger);

        const isRunning = await daemon.isDaemonRunning(projectRoot);

        if (isRunning) {
          console.log(chalk.gray(poltergeistMessage('info', 'Stopping current daemon...')));
          await daemon.stopDaemon(projectRoot);

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (options.foreground) {
          console.log(chalk.gray(poltergeistMessage('info', 'Starting in foreground mode...')));
          const poltergeist = createPoltergeist(config, projectRoot, logger, configPath);
          await poltergeist.start(options.target);
        } else {
          console.log(chalk.gray(poltergeistMessage('info', 'Starting new daemon...')));
          const pid = await daemon.startDaemonWithRetry(config, {
            projectRoot,
            configPath,
            target: options.target,
            verbose: options.verbose,
          });
          console.log(chalk.green(`${ghost.success()} Poltergeist daemon restarted (PID: ${pid})`));
        }
      } catch (error) {
        exitWithError(poltergeistMessage('error', `Restart failed: ${error}`));
      }
    });

  applyConfigOption(restartCmd);
  applyTargetOption(restartCmd);
  applyLogLevelOptions(restartCmd);

  program
    .command('build [target]')
    .description('Manually trigger a build for a target')
    .option('-c, --config <path>', 'Path to config file')
    .option('--verbose', 'Show build output in real-time')
    .option('-f, --force', 'Force rebuild even if another build is running')
    .option('--json', 'Output result as JSON')
    .action(async (targetName, options) => {
      const { config, projectRoot } = await loadConfigOrExit(options.config);
      const logger = createLogger(options.verbose ? 'debug' : config.logging?.level || 'info');

      try {
        let targetToBuild: Target | undefined;

        if (targetName) {
          targetToBuild = ConfigurationManager.findTarget(config, targetName) ?? undefined;
          if (!targetToBuild) {
            const available = config.targets
              .map((t) => `  - ${t.name} (${t.enabled ? 'enabled' : 'disabled'})`)
              .join('\n');
            exitWithError(`❌ Target '${targetName}' not found\nAvailable targets:\n${available}`);
          }
        } else {
          const enabledTargets = config.targets.filter((t) => t.enabled !== false);
          if (enabledTargets.length === 0) {
            exitWithError('❌ No enabled targets found');
          } else if (enabledTargets.length === 1) {
            targetToBuild = enabledTargets[0];
          } else {
            const list = enabledTargets.map((t) => `  - ${t.name}`).join('\n');
            exitWithError(
              `❌ Multiple targets available. Please specify:\n${list}\nUsage: poltergeist build <target>`
            );
          }
        }

        if (!targetToBuild) {
          exitWithError('❌ No target resolved for build');
        }

        const target = targetToBuild as Target;

        console.log(chalk.cyan(`🔨 Building ${target.name}...`));

        const stateManager = await instantiateStateManager(projectRoot, logger);
        const builder = await createBuilderForTarget(target, projectRoot, logger, stateManager);

        const startTime = Date.now();
        let lockHintShown = false;
        const showLockHints = (): void => {
          if (lockHintShown || options.json) return;
          lockHintShown = true;
          printBuildLockHints(target.name);
        };
        const buildStatus = await builder.build([], {
          captureLogs: true,
          logFile: `.poltergeist-build-${target.name}.log`,
          force: options.force ?? false,
          onLock: showLockHints,
        });

        const duration = Date.now() - startTime;

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                target: target.name,
                targetName: target.name,
                status: buildStatus.status,
                duration,
                timestamp: new Date().toISOString(),
                error: buildStatus.status === 'failure' ? buildStatus.errorSummary : undefined,
              },
              null,
              2
            )
          );
        } else {
          if (buildStatus.status === 'success') {
            console.log(chalk.green(`✅ Build completed successfully in ${Math.round(duration / 1000)}s`));
          } else if (buildStatus.status === 'building') {
            showLockHints();
            exitWithError('Build skipped because another build is already running.');
          } else {
            console.error(chalk.red(`❌ Build failed after ${Math.round(duration / 1000)}s`));
            if (buildStatus.errorSummary) {
              console.error(chalk.red(`Error: ${buildStatus.errorSummary}`));
            }
            exitWithError('Build failed');
          }
        }
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                error: error instanceof Error ? error.message : String(error),
                status: 'error',
              },
              null,
              2
            )
          );
        } else {
          console.error(chalk.red(`❌ Build failed: ${error instanceof Error ? error.message : error}`));
        }
        exitWithError('Build failed');
      }
    });
};
