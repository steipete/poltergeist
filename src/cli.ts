#!/usr/bin/env node
// Test change for v1.7.0 testing
// import { resolve } from 'path';
import chalk from 'chalk';
// Updated CLI for generic target system
import { Command } from 'commander';
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path, { join } from 'path';
import type { LoadedConfiguration } from './cli/configuration.js';
import { loadConfiguration, parseGitSummaryModeOption } from './cli/configuration.js';
import {
  augmentConfigWithDetectedTargets,
  findXcodeProjects,
  generateDefaultConfig,
  guessBundleId,
} from './cli/init-helpers.js';
import { displayLogs } from './cli/logging.js';
import { formatTargetStatus, printBuildLockHints } from './cli/status-formatters.js';
// Version is hardcoded at compile time - NEVER read from filesystem
// This ensures the binary always reports its compiled version
import { PACKAGE_INFO } from './cli/version.js';
import {
  configurePolterCommand,
  getPolterDescription,
  parsePolterOptions,
} from './cli-shared/polter-command.js';
// import { Poltergeist } from './poltergeist.js';
// Static import for daemon-worker to ensure it's included in Bun binary
import { runDaemon } from './daemon/daemon-worker.js';
import { createPoltergeist } from './factories.js';
import { createLogger, type Logger } from './logger.js';
import { runStatusPanel } from './panel/run-panel.js';
import type { StatusObject } from './status/types.js';
import type { AppBundleTarget, PoltergeistConfig, ProjectType, Target } from './types.js';
import { CLIFormatter, type CommandGroup, type OptionInfo } from './utils/cli-formatter.js';
import { CMakeProjectAnalyzer } from './utils/cmake-analyzer.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { FileSystemUtils } from './utils/filesystem.js';
import { ghost, poltergeistMessage } from './utils/ghost.js';
import { DEFAULT_LOG_CHANNEL, sanitizeLogChannel } from './utils/log-channels.js';
import { isMainModule } from './utils/paths.js';
import { validateTarget } from './utils/target-validator.js';
import { WatchmanConfigManager } from './watchman-config.js';

const { version } = PACKAGE_INFO;

const program = new Command();

const exitWithError = (message: string, code = 1): never => {
  console.error(chalk.red(message));
  process.exit(code);
};

const loadConfigOrExit = async (configPath?: string): Promise<LoadedConfiguration> => {
  try {
    return await loadConfiguration(configPath);
  } catch (error) {
    return exitWithError((error as Error).message);
  }
};

const parseGitModeOrExit = (value?: string): 'ai' | 'list' | undefined => {
  try {
    return parseGitSummaryModeOption(value);
  } catch (error) {
    return exitWithError((error as Error).message);
  }
};

program
  .name('poltergeist')
  .description(`👻 ${chalk.cyan('Poltergeist - The ghost that keeps your projects fresh')}`)
  .version(version, '-v, --version', 'output the version number')
  .configureHelp({
    formatHelp: () => {
      const commandGroups: CommandGroup[] = [
        {
          title: 'Daemon Control',
          commands: [
            { name: 'start', aliases: ['haunt'], description: 'Start watching and auto-building' },
            { name: 'stop', aliases: ['rest'], description: 'Stop Poltergeist daemon' },
            { name: 'restart', description: 'Restart Poltergeist daemon' },
            { name: 'status', description: 'Check build and daemon status' },
          ],
        },
        {
          title: 'Project Management',
          commands: [
            { name: 'init', description: 'Initialize configuration' },
            { name: 'list', description: 'List all configured targets' },
            { name: 'clean', description: 'Clean up stale state files' },
          ],
        },
        {
          title: 'Development',
          commands: [
            { name: 'logs', args: '[target]', description: 'Show build logs' },
            { name: 'wait', args: '[target]', description: 'Wait for build to complete' },
            { name: 'polter', args: '<target> [args...]', description: 'Execute fresh binaries' },
            { name: 'panel', description: 'Interactive status dashboard' },
            { name: 'version', description: 'Show Poltergeist version' },
          ],
        },
      ];

      const options: OptionInfo[] = [
        { flags: '-v, --version', description: 'Show version' },
        { flags: '-h, --help', description: 'Show help' },
      ];

      return CLIFormatter.formatHelp({
        title: 'Poltergeist',
        tagline: 'The ghost that keeps your projects fresh',
        programName: 'poltergeist',
        usage: '<command> [options]',
        commandGroups,
        options,
        examples: [
          { command: 'start', description: 'Start watching all enabled targets' },
          { command: 'start --target my-app', description: 'Watch specific target only' },
          { command: 'status --verbose', description: 'Show detailed status' },
          { command: 'logs my-app', description: 'Show logs for specific target' },
        ],
      });
    },
  });

program
  .command('haunt')
  .alias('start')
  .description(
    'Start watching and auto-building your project (spawns a daemon and returns immediately)'
  )
  .option('-t, --target <name>', 'Target to build (omit to build all enabled targets)')
  .option('-c, --config <path>', 'Path to config file')
  .option('--verbose', 'Enable verbose logging (same as --log-level debug)')
  .option('--log-level <level>', 'Set log level (debug, info, warn, error)')
  .option('-f, --foreground', 'Run in foreground (blocking mode)')
  .action(async (options) => {
    const { config, projectRoot, configPath } = await loadConfigOrExit(options.config);

    // Validate target if specified
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

    // Determine log level: CLI flag > verbose flag > config > default
    const logLevel =
      options.logLevel || (options.verbose ? 'debug' : config.logging?.level || 'info');

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
      // Default path: launch the daemon in the background and exit quickly so shells/tmux panes stay free.
      const isTestMode = process.env.POLTERGEIST_TEST_MODE === 'true';

      // Daemon mode (default)
      try {
        if (isTestMode) {
          console.log(chalk.gray(poltergeistMessage('info', 'Starting daemon...')));
          console.log(
            chalk.green(`${ghost.success()} Poltergeist daemon started (PID: test-mode)`)
          );
          console.log(chalk.gray('Use "poltergeist logs" to see output'));
          console.log(chalk.gray('Use "poltergeist status" to check build status'));
          console.log(chalk.gray('Use "poltergeist stop" to stop watching'));
          return;
        }

        const { DaemonManager } = await import('./daemon/daemon-manager.js');
        const daemon = new DaemonManager(logger);

        // Check if already running
        if (await daemon.isDaemonRunning(projectRoot)) {
          console.log(
            chalk.yellow(
              `${ghost.warning()} Poltergeist daemon is already running for this project`
            )
          );
          console.log(chalk.gray('Use "poltergeist status" to see details'));
          console.log(chalk.gray('Use "poltergeist stop" to stop the daemon'));
          flushLoggerIfPossible();
          exitWithError('Daemon already running');
        }

        console.log(chalk.gray(poltergeistMessage('info', 'Starting daemon...')));

        // Start daemon with retry logic
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
      // Foreground mode (traditional blocking behavior)
      console.log(chalk.gray(poltergeistMessage('info', 'Running in foreground mode...')));

      if (options.target) {
        console.log(chalk.gray(poltergeistMessage('info', `Building target: ${options.target}`)));
      } else {
        const enabledTargets = config.targets.filter((t) => t.enabled);
        console.log(
          chalk.gray(
            poltergeistMessage('info', `Building ${enabledTargets.length} enabled target(s)`)
          )
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

program
  .command('stop')
  .alias('rest')
  .description('Stop Poltergeist daemon')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const { config, projectRoot } = await loadConfigOrExit(options.config);
    const logger = createLogger(config.logging?.level || 'info');
    const isTestMode = process.env.POLTERGEIST_TEST_MODE === 'true';
    if (isTestMode) {
      const pretendRunning = process.env.POLTERGEIST_TEST_DAEMON_RUNNING === 'true';
      if (!pretendRunning) {
        console.log(
          chalk.yellow(`${ghost.warning()} No Poltergeist daemon running for this project`)
        );
        process.exit(1);
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
      const { DaemonManager } = await import('./daemon/daemon-manager.js');
      const daemon = new DaemonManager(logger);

      // Check if daemon is running
      if (!(await daemon.isDaemonRunning(projectRoot))) {
        console.log(
          chalk.yellow(`${ghost.warning()} No Poltergeist daemon running for this project`)
        );
        exitWithError('No daemon running');
      }

      console.log(chalk.gray(poltergeistMessage('info', 'Stopping daemon...')));
      await daemon.stopDaemon(projectRoot);
      console.log(chalk.green(poltergeistMessage('success', 'Daemon stopped successfully')));
    } catch (error) {
      exitWithError(poltergeistMessage('error', `Failed to stop daemon: ${error}`));
    }
  });

program
  .command('restart')
  .description('Restart Poltergeist daemon')
  .option('-c, --config <path>', 'Path to config file')
  .option('-f, --foreground', 'Restart in foreground mode')
  .option('--verbose', 'Enable verbose logging')
  .option('-t, --target <name>', 'Target to build')
  .action(async (options) => {
    console.log(chalk.gray(poltergeistMessage('info', 'Restarting...')));

    const { config, projectRoot, configPath } = await loadConfigOrExit(options.config);
    const logger = createLogger(config.logging?.level || 'info');

    try {
      const { DaemonManager } = await import('./daemon/daemon-manager.js');
      const daemon = new DaemonManager(logger);

      // Check if daemon is running
      const isRunning = await daemon.isDaemonRunning(projectRoot);

      if (isRunning) {
        console.log(chalk.gray(poltergeistMessage('info', 'Stopping current daemon...')));
        await daemon.stopDaemon(projectRoot);

        // Wait a moment to ensure clean shutdown
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (options.foreground) {
        // Restart in foreground mode
        console.log(chalk.gray(poltergeistMessage('info', 'Starting in foreground mode...')));
        const poltergeist = createPoltergeist(config, projectRoot, logger, configPath);
        await poltergeist.start(options.target);
      } else {
        // Restart as daemon with retry logic
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
      // Get target to build
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
        // No target specified - build first enabled target
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
        exitWithError('❌ No target resolved for build'); // safety net
      }

      const target = targetToBuild as Target;

      console.log(chalk.cyan(`🔨 Building ${target.name}...`));

      // Get the builder directly
      const { createBuilder } = await import('./builders/index.js');
      const { StateManager } = await import('./state.js');
      const stateManager = new StateManager(projectRoot, logger);
      const builder = createBuilder(target, projectRoot, logger, stateManager);

      // Execute build with real-time output
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
          console.log(
            chalk.green(`✅ Build completed successfully in ${Math.round(duration / 1000)}s`)
          );
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
        console.error(
          chalk.red(`❌ Build failed: ${error instanceof Error ? error.message : error}`)
        );
      }
      exitWithError('Build failed');
    }
  });

program
  .command('version')
  .description('Show Poltergeist version')
  .action(() => {
    console.log(`Poltergeist v${version}`);
  });

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
          // Check if target exists in status
          const targetStatus = status[effectiveTarget];
          if (!targetStatus) {
            console.log(chalk.yellow(`Target '${effectiveTarget}' not found`));
          } else {
            formatTargetStatus(effectiveTarget, targetStatus, options.verbose);
          }
        } else {
          // All targets status
          const targets = Object.keys(status).filter((key) => !key.startsWith('_'));
          if (targets.length === 0) {
            console.log(chalk.gray('No targets configured'));
          } else {
            targets.forEach((name) => {
              formatTargetStatus(name, status[name], options.verbose);
              console.log(); // Empty line between targets
            });
          }

          console.log(
            chalk.gray('Tip: run "poltergeist status panel" to open the live dashboard.')
          );
        }
      }
    } catch (error) {
      exitWithError(poltergeistMessage('error', `Failed to get status: ${error}`));
    }
  });

program
  .command('init')
  .description('Initialize Poltergeist configuration for your project')
  .option('--cmake', 'Initialize for CMake project')
  .option('--auto', 'Auto-detect project type')
  .option('--preset <name>', 'Use specific CMake preset')
  .option('--generator <gen>', 'CMake generator to use')
  .option('--build-dir <dir>', 'Build directory', 'build')
  .option('--dry-run', 'Show what would be generated without creating config')
  .option('--no-auto-add', 'Skip auto-adding inferred targets when none are enabled')
  .action(async (options) => {
    const projectRoot = process.cwd();
    const configPath = join(projectRoot, 'poltergeist.config.json');

    // Check if config already exists
    if (existsSync(configPath) && !options.dryRun) {
      exitWithError(
        '❌ poltergeist.config.json already exists!\nRemove it first or use --dry-run to preview changes.'
      );
    }

    console.log(chalk.gray(poltergeistMessage('info', 'Initializing configuration...')));

    // Detect project type
    let projectType: ProjectType;

    if (options.cmake) {
      projectType = 'cmake';
    } else if (options.auto) {
      const logger = createLogger();
      const watchmanManager = new WatchmanConfigManager(projectRoot, logger);
      projectType = await watchmanManager.detectProjectType();
      console.log(chalk.blue(`Auto-detected project type: ${projectType}`));
    } else {
      // Interactive prompt would go here, for now default to auto-detect
      const logger = createLogger();
      const watchmanManager = new WatchmanConfigManager(projectRoot, logger);
      projectType = await watchmanManager.detectProjectType();
      console.log(chalk.blue(`Auto-detected project type: ${projectType}`));
    }

    let config: PoltergeistConfig;

    if (projectType === 'cmake') {
      try {
        const analyzer = new CMakeProjectAnalyzer(projectRoot);
        console.log(chalk.gray('Analyzing CMake project...'));
        const analysis = await analyzer.analyzeProject();

        console.log(chalk.green(`✅ Found ${analysis.targets.length} CMake targets`));
        if (analysis.generator) {
          console.log(chalk.blue(`📊 Generator: ${analysis.generator}`));
        }

        // Generate configuration
        const targets = analyzer.generatePoltergeistTargets(analysis);

        config = {
          version: '1.0',
          projectType: 'cmake',
          targets,
          watchman: {
            excludeDirs: [analysis.buildDirectory || 'build'],
          },
          notifications: {
            successSound: 'Glass',
            failureSound: 'Basso',
          },
        } as PoltergeistConfig;

        // Apply options
        if (options.generator) {
          targets.forEach((target) => {
            if ('generator' in target && target.generator !== undefined) {
              target.generator = options.generator;
            }
          });
        }
      } catch (error) {
        console.error(chalk.red(`Failed to analyze CMake project: ${error}`));
        process.exit(1);
      }
    } else {
      // Generate config for other project types
      if (projectType === 'swift' || projectType === 'mixed') {
        // Look for Xcode projects
        const xcodeProjects = await findXcodeProjects(projectRoot);

        if (xcodeProjects.length > 0) {
          console.log(chalk.green(`✅ Found ${xcodeProjects.length} Xcode project(s)`));

          const targets: Target[] = [];
          const usedNames = new Set<string>();

          for (const project of xcodeProjects) {
            const projectDir = path.dirname(project.path);
            const projectName = path.basename(project.path, path.extname(project.path));
            const relativeDir = path.relative(projectRoot, projectDir) || '.';
            const isIOS =
              projectName.toLowerCase().includes('ios') ||
              project.path.toLowerCase().includes('/ios/');

            // Create a sanitized target name
            const targetName =
              projectName
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .replace(/ios$/, '') || 'app';

            // Ensure unique target name
            let finalTargetName = isIOS ? `${targetName}-ios` : targetName;
            let suffix = 2;
            while (usedNames.has(finalTargetName)) {
              finalTargetName = isIOS ? `${targetName}${suffix}-ios` : `${targetName}${suffix}`;
              suffix++;
            }
            usedNames.add(finalTargetName);

            const buildScript = existsSync(path.join(projectDir, 'scripts', 'build.sh'));
            const buildCommand = buildScript
              ? `cd ${relativeDir} && ./scripts/build.sh --configuration Debug`
              : project.type === 'xcworkspace'
                ? `cd ${relativeDir} && xcodebuild -workspace ${path.basename(project.path)} -scheme ${project.scheme || projectName} -configuration Debug build`
                : `cd ${relativeDir} && xcodebuild -project ${path.basename(project.path)} -scheme ${project.scheme || projectName} -configuration Debug build`;

            const target: AppBundleTarget = {
              name: finalTargetName,
              type: 'app-bundle',
              buildCommand,
              bundleId: guessBundleId(projectName, project.path),
              watchPaths: [
                `${relativeDir}/**/*.swift`,
                `${relativeDir}/**/*.xcodeproj/**`,
                `${relativeDir}/**/*.xcconfig`,
                `${relativeDir}/**/*.entitlements`,
                `${relativeDir}/**/*.plist`,
              ],
              environment: {
                CONFIGURATION: 'Debug',
              },
            };

            // For iOS targets, add enabled: false
            if (isIOS) {
              target.enabled = false;
            }

            targets.push(target);
          }

          config = {
            version: '1.0',
            projectType: 'swift', // Always use swift if we find Xcode projects
            targets,
          };
        } else {
          config = generateDefaultConfig(projectType);
        }
      } else {
        config = generateDefaultConfig(projectType);
      }
    }

    const detectedTargets = await augmentConfigWithDetectedTargets(projectRoot, config, {
      allowAutoAdd: options.autoAdd !== false,
    });

    const configJson = JSON.stringify(config, null, 2);

    if (options.dryRun) {
      console.log(chalk.yellow('\n--dry-run mode, would create:'));
      console.log(chalk.gray('poltergeist.config.json:'));
      console.log(configJson);
      if (detectedTargets.length > 0) {
        console.log(
          chalk.gray(
            `Auto-detected targets (not written): ${detectedTargets
              .map((t) => `${t.name} (${t.reason})`)
              .join(', ')}`
          )
        );
      }
    } else {
      writeFileSync(configPath, configJson, 'utf-8');
      console.log(chalk.green('✅ Created poltergeist.config.json'));
      if (detectedTargets.length > 0) {
        console.log(
          chalk.gray(
            `Auto-added targets: ${detectedTargets
              .map((t) => `${t.name} (${t.reason})`)
              .join(', ')}`
          )
        );
      }

      // Recommend CLAUDE.md for AI agents
      console.log(chalk.blue('\n📋 For AI Agent Integration (Claude, Cursor, etc.):'));
      console.log(chalk.gray('  Consider adding a CLAUDE.md file with instructions like:'));
      console.log(chalk.gray('  • NEVER manually run build commands when Poltergeist is running'));
      console.log(chalk.gray('  • ALWAYS use "polter <target>" to ensure fresh builds'));
      console.log(chalk.gray('  • Poltergeist automatically detects changes and rebuilds'));
      console.log(chalk.gray('  This helps AI agents work better with your project!'));

      console.log(chalk.blue(`\nNext steps:`));
      console.log(chalk.gray('  1. Review and adjust the configuration as needed'));
      console.log(chalk.gray('  2. Run "poltergeist haunt" to start watching'));
    }
  });

// Helper function to find Xcode projects in directory
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
    const logChannel = sanitizeLogChannel(options.channel ?? DEFAULT_LOG_CHANNEL);

    // Handle smart defaults for log display
    let logTarget = targetName;

    if (!targetName) {
      // No target specified - need to be smart about it
      const logger = createLogger(undefined, config.logging?.level || 'info');
      const poltergeist = createPoltergeist(config, projectRoot, logger, options.config || '');
      const status = await poltergeist.getStatus();

      // Find active or recent builds
      const targetStatuses: Array<{ name: string; status: StatusObject }> = [];
      for (const [name, targetStatus] of Object.entries(status)) {
        if (name.startsWith('_')) continue;
        targetStatuses.push({ name, status: targetStatus as StatusObject });
      }

      if (targetStatuses.length === 0) {
        console.error(chalk.red('No targets found'));
        process.exit(1);
      } else if (targetStatuses.length === 1) {
        // Single target, use it
        logTarget = targetStatuses[0].name;
      } else {
        // Multiple targets - check for currently building ones
        const buildingTargets = targetStatuses.filter(
          (t) => t.status.lastBuild?.status === 'building'
        );

        if (buildingTargets.length === 1) {
          // Single building target, use it
          logTarget = buildingTargets[0].name;
        } else if (buildingTargets.length > 1) {
          // Multiple building targets
          console.error(chalk.red('❌ Multiple targets available. Please specify:'));
          for (const t of buildingTargets) {
            console.error(`   - ${t.name} (currently building)`);
          }
          console.error(`   Usage: poltergeist logs <target>`);
          process.exit(1);
        } else {
          // No building targets, show all available
          console.error(chalk.red('❌ Multiple targets available. Please specify:'));
          for (const t of targetStatuses) {
            const lastBuild = t.status.lastBuild;
            const buildInfo = lastBuild
              ? `(last built ${new Date(lastBuild.timestamp).toLocaleString()})`
              : '(never built)';
            console.error(`   - ${t.name} ${buildInfo}`);
          }
          console.error(`   Usage: poltergeist logs <target>`);
          process.exit(1);
        }
      }
    }

    // Note: Don't validate target exists - it might have been removed but still have logs

    const resolveLogPath = (logPath?: string): string | undefined => {
      if (!logPath) return undefined;
      return path.isAbsolute(logPath) ? logPath : path.join(projectRoot, logPath);
    };

    const candidateLogFiles = [
      logTarget ? FileSystemUtils.getLogFilePath(projectRoot, logTarget, logChannel) : undefined,
      resolveLogPath(config.logging?.file),
      path.join(projectRoot, '.poltergeist.log'),
      logTarget ? path.join(projectRoot, `${logTarget}.log`) : undefined,
      logTarget ? path.join(projectRoot, `.poltergeist-${logTarget}.log`) : undefined,
    ]
      .filter((filePath): filePath is string => !!filePath)
      // Remove duplicates while preserving order
      .filter((filePath, index, self) => self.indexOf(filePath) === index);

    const logFile = candidateLogFiles.find((filePath) => existsSync(filePath));

    if (!logFile) {
      console.error(chalk.red(`No log file found for target: ${logTarget}`));
      console.error(chalk.yellow('💡 Start Poltergeist to generate logs: poltergeist start'));
      process.exit(1);
    }

    try {
      // Use tail option or default to 100 lines
      const lines = options.tail || '100';
      await displayLogs(logFile, {
        target: logTarget,
        lines,
        follow: options.follow,
        json: options.json,
      });
    } catch (error) {
      console.error(
        chalk.red(`Failed to read logs: ${error instanceof Error ? error.message : error}`)
      );
      process.exit(1);
    }
  });

// Old wait command implementation removed - newer implementation exists below

program
  .command('list')
  .description('List all configured targets')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const { config } = await loadConfigOrExit(options.config);

    console.log(chalk.cyan(`${ghost.brand()} Configured Targets`));
    console.log(chalk.gray('═'.repeat(50)));

    if (config.targets.length === 0) {
      console.log(chalk.gray('No targets configured'));
    } else {
      config.targets.forEach((target) => {
        const status = target.enabled ? chalk.green('✓') : chalk.red('✗');
        console.log(`${status} ${chalk.cyan(target.name)} (${target.type})`);
        console.log(`  Build: ${target.buildCommand}`);
        console.log(`  Watch: ${target.watchPaths.join(', ')}`);

        if (target.type === 'executable' && 'outputPath' in target) {
          console.log(`  Output: ${target.outputPath}`);
        } else if (target.type === 'app-bundle' && 'bundleId' in target) {
          console.log(`  Bundle ID: ${target.bundleId}`);
          if (target.platform) {
            console.log(`  Platform: ${target.platform}`);
          }
        }
        console.log();
      });
    }
  });

program
  .command('wait [target]')
  .description('Wait for a build to complete')
  .option('-t, --timeout <seconds>', 'Maximum time to wait in seconds', '300')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (targetName, options) => {
    const { config, projectRoot } = await loadConfigOrExit(options.config);
    const logger = createLogger(config.logging?.level || 'info');
    const poltergeist = createPoltergeist(config, projectRoot, logger, options.config || '');

    try {
      // Get current status
      const status = await poltergeist.getStatus();

      // Find currently building targets
      const activeBuilds = Object.entries(status)
        .filter(
          ([name, s]) =>
            !name.startsWith('_') && (s as StatusObject).lastBuild?.status === 'building'
        )
        .map(([name, s]) => ({ name, status: s as StatusObject }));

      // Determine which target to wait for
      let targetToWait: string | undefined;
      let targetStatus: StatusObject | undefined;

      if (targetName) {
        // Validate target exists
        validateTarget(targetName, config);

        // Specific target requested
        const statusObj = status[targetName] as StatusObject;
        if (statusObj.lastBuild?.status !== 'building') {
          console.log(chalk.yellow(`Target '${targetName}' is not currently building`));
          process.exit(0);
        }
        targetToWait = targetName;
        targetStatus = statusObj;
      } else if (activeBuilds.length === 0) {
        console.log(chalk.yellow('No builds currently active'));
        process.exit(0);
      } else if (activeBuilds.length === 1) {
        // Single building target, use it
        targetToWait = activeBuilds[0].name;
        targetStatus = activeBuilds[0].status;
      } else {
        // Multiple building targets
        console.error(chalk.red('❌ Multiple targets building. Please specify:'));
        for (const { name, status } of activeBuilds) {
          const buildCommand = (status as StatusObject).buildCommand || 'build command unknown';
          console.error(`   ${chalk.cyan(name)}: ${chalk.gray(buildCommand)}`);
        }
        console.error(`   Usage: poltergeist wait <target>`);
        process.exit(1);
      }

      // Show initial status
      if (!process.stdout.isTTY) {
        // Agent mode - minimal output
        console.log(`⏳ Waiting for '${targetToWait}' build...`);
        if (targetStatus.buildCommand) {
          console.log(`Command: ${targetStatus.buildCommand}`);
        }

        // Show time estimate if available
        if (targetStatus.lastBuild?.timestamp) {
          const elapsed = Date.now() - new Date(targetStatus.lastBuild.timestamp).getTime();
          const elapsedSec = Math.round(elapsed / 1000);

          if (targetStatus.buildStats?.averageDuration) {
            const avgSec = Math.round(targetStatus.buildStats.averageDuration / 1000);
            const remaining = Math.max(0, avgSec - elapsedSec);
            console.log(`Started: ${elapsedSec}s ago, ~${remaining}s remaining`);
          } else {
            console.log(`Started: ${elapsedSec}s ago`);
          }
        }
      } else {
        // Human mode - more verbose
        console.log(chalk.blue(`⏳ Waiting for '${targetToWait}' to complete...`));
      }

      // Poll for completion
      const timeout = Number.parseInt(options.timeout, 10) * 1000;
      const pollInterval = 1000; // 1 second
      const startTime = Date.now();

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        // Check timeout
        if (Date.now() - startTime > timeout) {
          console.log(chalk.red('❌ Build failed'));
          console.log('Error: Timeout exceeded');
          process.exit(1);
        }

        // Get updated status
        if (!targetToWait) {
          // This should never happen due to the logic above
          console.log(chalk.red('❌ Build failed'));
          console.log('Error: No target selected');
          process.exit(1);
        }
        const updatedStatus = await poltergeist.getStatus(targetToWait);
        const targetUpdate = updatedStatus[targetToWait] as StatusObject;

        if (!targetUpdate) {
          console.log(chalk.red('❌ Build failed'));
          console.log('Error: Target disappeared');
          process.exit(1);
        }

        const buildStatus = targetUpdate.lastBuild?.status;

        if (buildStatus === 'success') {
          if (!process.stdout.isTTY) {
            console.log('✅ Build completed successfully');
            if (targetUpdate.lastBuild?.duration) {
              const durSec = Math.round(targetUpdate.lastBuild.duration / 1000);
              console.log(`Duration: ${durSec}s`);
            }
          } else {
            console.log(chalk.green('✅ Build completed successfully'));
          }
          process.exit(0);
        } else if (buildStatus === 'failure') {
          console.log(chalk.red('❌ Build failed'));
          if (targetUpdate.lastBuild?.errorSummary) {
            console.log(`Error: ${targetUpdate.lastBuild.errorSummary}`);
          }
          process.exit(1);
        } else if (buildStatus !== 'building') {
          console.log(chalk.red('❌ Build failed'));
          console.log(`Error: Build ended with status: ${buildStatus}`);
          process.exit(1);
        }
        // Continue polling if still building
      }
    } catch (error) {
      console.error(chalk.red(`Failed to wait: ${error}`));
      process.exit(1);
    }
  });

program
  .command('clean')
  .description('Clean up stale state files')
  .option('-a, --all', 'Remove all state files, not just stale ones')
  .option('-d, --days <number>', 'Remove state files older than N days', '7')
  .option('--dry-run', 'Show what would be removed without actually removing')
  .action(async (options) => {
    try {
      console.log(chalk.gray(poltergeistMessage('info', 'Cleaning up state files...')));

      const { StateManager } = await import('./state.js');
      const stateFiles = await StateManager.listAllStates();

      if (stateFiles.length === 0) {
        console.log(chalk.green('No state files found'));
        return;
      }

      const logger = createLogger();
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysThreshold = Number.parseInt(options.days, 10);
      const ageThreshold = Date.now() - daysThreshold * msPerDay;
      const fallbackProjectRoot = FileSystemUtils.findProjectRoot(process.cwd()) || process.cwd();
      let removedCount = 0;
      let candidateCount = 0;

      if (process.env.POLTERGEIST_DEBUG_CLEAN === 'true') {
        console.log('CLEAN files', JSON.stringify(stateFiles));
      }

      const deriveTargetName = (fileName: string): string => {
        const hashedPattern = /^(.*?)-([0-9a-f]{8})-(.+)\.state$/i;
        const match = fileName.match(hashedPattern);
        if (match) {
          return match[3];
        }
        return fileName.replace(/\.state$/i, '');
      };

      const readStateForFile = async (
        manager: any,
        file: string,
        targetName: string
      ): Promise<any> => {
        let state = await manager.readState(targetName);
        if (!state) {
          const fallbackName = file.replace(/\.state$/i, '');
          if (fallbackName && fallbackName !== targetName) {
            state = await manager.readState(fallbackName);
          }
        }
        return state;
      };

      const instantiateStateManager = () => {
        if (typeof StateManager !== 'function') {
          throw new Error('StateManager is not constructible');
        }

        try {
          return (StateManager as unknown as (projectRoot: string, logger: Logger) => any)(
            fallbackProjectRoot,
            logger
          );
        } catch (error) {
          if (error instanceof TypeError && error.message.includes('class constructor')) {
            return new StateManager(fallbackProjectRoot, logger);
          }
          throw error;
        }
      };

      for (const file of stateFiles) {
        const stateManager = instantiateStateManager();
        const targetName = deriveTargetName(file);
        const state = await readStateForFile(stateManager, file, targetName);

        if (!state) {
          continue;
        }

        if (process.env.POLTERGEIST_DEBUG_CLEAN === 'true') {
          console.log(
            'CLEAN state',
            JSON.stringify(
              {
                file,
                targetName,
                process: state.process,
                options,
              },
              null,
              2
            )
          );
        }

        let shouldRemove = false;
        let reason = '';

        if (options.all) {
          shouldRemove = true;
          reason = 'all files';
        } else if (!state.process?.isActive) {
          const heartbeat = state.process?.lastHeartbeat
            ? new Date(state.process.lastHeartbeat).getTime()
            : undefined;
          if (heartbeat !== undefined && heartbeat < ageThreshold) {
            shouldRemove = true;
            reason = `inactive for ${daysThreshold}+ days`;
          }
        }

        if (!shouldRemove) {
          continue;
        }

        candidateCount++;

        const actionLabel = options.dryRun ? 'Would remove' : 'Removing';
        const message = `${actionLabel}: ${file}`;
        console.log(options.dryRun ? chalk.blue(message) : chalk.yellow(message));
        console.log(`    Project: ${state.projectName || 'unknown'}`);
        console.log(`    Target: ${state.target || targetName}`);

        if (state.process?.lastHeartbeat) {
          const heartbeatMs = new Date(state.process.lastHeartbeat).getTime();
          if (!Number.isNaN(heartbeatMs)) {
            const ageDays = Math.round((Date.now() - heartbeatMs) / msPerDay);
            console.log(`    Age: ${ageDays} days`);
          }
        }

        console.log(`    Reason: ${reason}`);
        console.log();

        if (!options.dryRun) {
          const removalKey = state.target || targetName;
          await stateManager.removeState(removalKey);
          removedCount++;
        }
      }

      if (options.dryRun) {
        console.log(chalk.blue(`Would remove ${candidateCount} state file(s)`));
      } else {
        console.log(
          chalk.green(poltergeistMessage('success', `Removed ${removedCount} state file(s)`))
        );
      }
    } catch (error) {
      if (process.env.POLTERGEIST_DEBUG_CLEAN === 'true') {
        console.error('CLEAN command failed:', error);
      }
      throw error;
    }
  });
// Add polter command - delegate to polter CLI using shared configuration
const polterCommand = program
  .command('polter <target> [args...]')
  .description(getPolterDescription());

// Configure with shared options
configurePolterCommand(polterCommand);

polterCommand.action(async (target: string, args: string[], options) => {
  // Import and run the polter functionality
  const { runWrapper } = await import('./polter.js');

  // Use shared option parser
  const parsedOptions = parsePolterOptions(options);

  await runWrapper(target, args, parsedOptions);
});

// Backwards compatibility warning for old flags
const warnOldFlag = (flag: string, newFlag: string) => {
  console.error(chalk.red(`❌ The ${flag} flag is no longer supported!`));
  console.error(chalk.yellow(`Use ${newFlag} instead.`));
  console.error(chalk.gray('\nExample:'));
  console.error(chalk.gray(`  poltergeist haunt ${newFlag}`));
  process.exit(1);
};

// Add hidden options for deprecated flags
program.option('--cli', '(deprecated) Use --target <name> instead');
program.option('--mac', '(deprecated) Use --target <name> instead');

// Add handlers for old flags
program.on('option:cli', () => warnOldFlag('--cli', '--target <name>'));
program.on('option:mac', () => warnOldFlag('--mac', '--target <name>'));

// Check if running as daemon mode (for Bun standalone compatibility)
if (process.argv.includes('--daemon-mode')) {
  // Run as daemon worker - import and execute daemon logic
  const daemonArgsIndex = process.argv.indexOf('--daemon-mode') + 1;
  const daemonArgsPath = process.argv[daemonArgsIndex];

  if (daemonArgsPath) {
    // Set up process for daemon mode
    process.title = 'poltergeist-daemon';

    let daemonArgs = daemonArgsPath;

    // Check if this is a file path (for Bun.spawn) or base64 args (for backward compatibility)
    if (daemonArgsPath.endsWith('.json')) {
      // It's a file path from Bun.spawn - read the JSON file
      try {
        daemonArgs = readFileSync(daemonArgsPath, 'utf-8');
        // Clean up the temp file after reading
        setTimeout(() => {
          try {
            unlinkSync(daemonArgsPath);
          } catch {
            // Ignore cleanup errors
          }
        }, 1000);
      } catch (error) {
        console.error('Failed to read daemon args file:', error);
        process.exit(1);
      }
    } else {
      // Try to decode as base64 for backward compatibility
      try {
        daemonArgs = Buffer.from(daemonArgsPath, 'base64').toString('utf-8');
      } catch {
        // If not base64, use as-is
      }
    }

    // Parse the daemon args
    let parsedArgs: any;
    try {
      parsedArgs = JSON.parse(daemonArgs);
    } catch (error) {
      console.error('Failed to parse daemon arguments:', error);
      process.exit(1);
    }

    // Run daemon worker using static import (for Bun binary compatibility)
    runDaemon(parsedArgs).catch((error) => {
      console.error('Failed to start daemon worker:', error);
      process.exit(1);
    });
  } else {
    console.error('Missing daemon arguments');
    process.exit(1);
  }
} else {
  // Check if we're being invoked as 'polter' instead of 'poltergeist'
  // For Bun compiled binaries, process.argv0 contains the invocation name
  // For Node.js, check process.argv[1]
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
    // Route to polter command behavior
    import('./polter.js')
      .then(() => {
        // The polter module handles its own CLI parsing
      })
      .catch((err) => {
        console.error('Failed to load polter:', err);
        process.exit(1);
      });
  } else {
    // Parse arguments only when run directly (not when imported for testing)
    // Allow execution when imported by wrapper scripts (like poltergeist.ts)
    const isDirectRun = isMainModule();
    const isWrapperRun =
      process.argv[1]?.endsWith('poltergeist.ts') || process.argv[1]?.endsWith('poltergeist');

    // Also check if we're running as a Bun compiled binary
    const isBunBinary =
      process.argv[0]?.includes('/$bunfs/') ||
      (process.execPath && !process.execPath.endsWith('bun') && !process.execPath.endsWith('node'));

    if (isDirectRun || isWrapperRun || isBunBinary) {
      program.parse(process.argv);

      // Show help if no command specified
      if (!process.argv.slice(2).length) {
        program.outputHelp();
      }
    }
  }
}

// Export program for testing
export { program };
// Trigger rebuild
// Test file watching
// Test file watching Wed Jul 30 20:26:08 CEST 2025
// Another test Wed Jul 30 20:26:59 CEST 2025
// Testing file change logging in build messages - testing both fixes!
