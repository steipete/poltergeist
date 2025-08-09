#!/usr/bin/env node
// Test change for v1.7.0 testing
// import { resolve } from 'path';
import chalk from 'chalk';
// Updated CLI for generic target system
import { Command } from 'commander';
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync, watchFile, writeFileSync } from 'fs';
import { readdir } from 'fs/promises';
import path, { join } from 'path';
import { createInterface } from 'readline';
import { getDirname, isMainModule } from './utils/paths.js';

// Get directory without import.meta.url for bytecode compatibility
const __dirname = getDirname();
// Try multiple paths to find package.json (works in both src/ and dist/)
let packageJson: any;
try {
  // Try from dist directory first
  packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
} catch {
  try {
    // Try from src directory (during tests)
    packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
  } catch {
    // Fallback to a default version
    packageJson = { version: '1.6.3', name: '@steipete/poltergeist' };
  }
}

import {
  configurePolterCommand,
  getPolterDescription,
  parsePolterOptions,
} from './cli-shared/polter-command.js';
// import { Poltergeist } from './poltergeist.js';
import { ConfigurationError } from './config.js';
import { createPoltergeist } from './factories.js';
import { createLogger } from './logger.js';
import type { AppBundleTarget, PoltergeistConfig, ProjectType, Target } from './types.js';
import { CLIFormatter, type CommandGroup, type OptionInfo } from './utils/cli-formatter.js';
import { CMakeProjectAnalyzer } from './utils/cmake-analyzer.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { ghost, poltergeistMessage } from './utils/ghost.js';
import { validateTarget } from './utils/target-validator.js';
import { WatchmanConfigManager } from './watchman-config.js';
// Static import for daemon-worker to ensure it's included in Bun binary
import { runDaemon } from './daemon/daemon-worker.js';

const { version } = packageJson;

const program = new Command();

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

// Helper function to load config and handle errors
async function loadConfiguration(
  configPath?: string
): Promise<{ config: PoltergeistConfig; projectRoot: string; configPath: string }> {
  try {
    const result = await ConfigurationManager.getConfig(configPath);
    return {
      config: result.config,
      projectRoot: result.projectRoot,
      configPath: result.configPath,
    };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(chalk.red(error.message));
    } else {
      console.error(chalk.red(`Failed to load configuration: ${error}`));
    }
    process.exit(1);
  }
}

program
  .command('haunt')
  .alias('start')
  .description('Start watching and auto-building your project (runs as daemon by default)')
  .option('-t, --target <name>', 'Target to build (omit to build all enabled targets)')
  .option('-c, --config <path>', 'Path to config file')
  .option('--verbose', 'Enable verbose logging (same as --log-level debug)')
  .option('--log-level <level>', 'Set log level (debug, info, warn, error)')
  .option('-f, --foreground', 'Run in foreground (blocking mode)')
  .action(async (options) => {
    const { config, projectRoot, configPath } = await loadConfiguration(options.config);

    // Validate target if specified
    if (options.target) {
      validateTarget(options.target, config);
    } else {
      const enabledTargets = config.targets.filter((t) => t.enabled);
      if (enabledTargets.length === 0) {
        console.log(chalk.yellow('⚠️ No enabled targets found in configuration'));
        console.log(chalk.dim('💡 Daemon will continue running. You can enable targets by editing poltergeist.config.json'));
      }
    }

    // Determine log level: CLI flag > verbose flag > config > default
    const logLevel = options.logLevel || (options.verbose ? 'debug' : config.logging?.level || 'info');
    
    const logger = createLogger(
      config.logging?.file || '.poltergeist.log',
      logLevel
    );

    if (!options.foreground) {
      // Daemon mode (default)
      try {
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
          process.exit(1);
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

        console.log(chalk.green(`${ghost.success()} Poltergeist daemon started (PID: ${pid})`));
        console.log(chalk.gray('Use "poltergeist logs" to see output'));
        console.log(chalk.gray('Use "poltergeist status" to check build status'));
        console.log(chalk.gray('Use "poltergeist stop" to stop watching'));
      } catch (error) {
        console.error(chalk.red(poltergeistMessage('error', `Failed to start daemon: ${error}`)));
        process.exit(1);
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
        console.error(
          chalk.red(poltergeistMessage('error', `Failed to start Poltergeist: ${error}`))
        );
        process.exit(1);
      }
    }
  });

program
  .command('stop')
  .alias('rest')
  .description('Stop Poltergeist daemon')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const { config, projectRoot } = await loadConfiguration(options.config);
    const logger = createLogger(config.logging?.level || 'info');

    try {
      const { DaemonManager } = await import('./daemon/daemon-manager.js');
      const daemon = new DaemonManager(logger);

      // Check if daemon is running
      if (!(await daemon.isDaemonRunning(projectRoot))) {
        console.log(
          chalk.yellow(`${ghost.warning()} No Poltergeist daemon running for this project`)
        );
        process.exit(1);
      }

      console.log(chalk.gray(poltergeistMessage('info', 'Stopping daemon...')));
      await daemon.stopDaemon(projectRoot);
      console.log(chalk.green(poltergeistMessage('success', 'Daemon stopped successfully')));
    } catch (error) {
      console.error(chalk.red(poltergeistMessage('error', `Failed to stop daemon: ${error}`)));
      process.exit(1);
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

    const { config, projectRoot, configPath } = await loadConfiguration(options.config);
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
      console.error(chalk.red(poltergeistMessage('error', `Restart failed: ${error}`)));
      process.exit(1);
    }
  });

program
  .command('build [target]')
  .description('Manually trigger a build for a target')
  .option('-c, --config <path>', 'Path to config file')
  .option('--verbose', 'Show build output in real-time')
  .option('--json', 'Output result as JSON')
  .action(async (targetName, options) => {
    const { config, projectRoot } = await loadConfiguration(options.config);
    const logger = createLogger(options.verbose ? 'debug' : config.logging?.level || 'info');

    try {
      // Get target to build
      let targetToBuild: Target | undefined;
      
      if (targetName) {
        targetToBuild = config.targets.find(t => t.name === targetName);
        if (!targetToBuild) {
          console.error(chalk.red(`❌ Target '${targetName}' not found`));
          console.error(chalk.yellow('Available targets:'));
          config.targets.forEach(t => {
            console.error(`  - ${t.name} (${t.enabled ? 'enabled' : 'disabled'})`);
          });
          process.exit(1);
        }
      } else {
        // No target specified - build first enabled target
        const enabledTargets = config.targets.filter(t => t.enabled !== false);
        if (enabledTargets.length === 0) {
          console.error(chalk.red('❌ No enabled targets found'));
          process.exit(1);
        } else if (enabledTargets.length === 1) {
          targetToBuild = enabledTargets[0];
        } else {
          console.error(chalk.red('❌ Multiple targets available. Please specify:'));
          enabledTargets.forEach(t => {
            console.error(`  - ${t.name}`);
          });
          console.error(chalk.yellow('Usage: poltergeist build <target>'));
          process.exit(1);
        }
      }

      console.log(chalk.cyan(`🔨 Building ${targetToBuild.name}...`));
      
      // Get the builder directly
      const { createBuilder } = await import('./builders/index.js');
      const { StateManager } = await import('./state.js');
      const stateManager = new StateManager(projectRoot, logger);
      const builder = createBuilder(targetToBuild, projectRoot, logger, stateManager);
      
      // Execute build with real-time output
      const startTime = Date.now();
      const buildStatus = await builder.build([], { 
        captureLogs: true,
        logFile: `.poltergeist-build-${targetToBuild.name}.log`
      });
      
      const duration = Date.now() - startTime;
      
      if (options.json) {
        console.log(JSON.stringify({
          target: targetToBuild.name,
          status: buildStatus.status,
          duration,
          timestamp: new Date().toISOString(),
          error: buildStatus.status === 'failure' ? buildStatus.errorSummary : undefined
        }, null, 2));
      } else {
        if (buildStatus.status === 'success') {
          console.log(chalk.green(`✅ Build completed successfully in ${Math.round(duration / 1000)}s`));
        } else {
          console.error(chalk.red(`❌ Build failed after ${Math.round(duration / 1000)}s`));
          if (buildStatus.errorSummary) {
            console.error(chalk.red(`Error: ${buildStatus.errorSummary}`));
          }
          process.exit(1);
        }
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          status: 'error'
        }, null, 2));
      } else {
        console.error(chalk.red(`❌ Build failed: ${error instanceof Error ? error.message : error}`));
      }
      process.exit(1);
    }
  });

program
  .command('version')
  .description('Show Poltergeist version')
  .action(() => {
    console.log(`Poltergeist v${version}`);
  });

program
  .command('status')
  .description('Check Poltergeist status')
  .option('-t, --target <name>', 'Check specific target status')
  .option('-c, --config <path>', 'Path to config file')
  .option('--verbose', 'Show detailed status information')
  .option('--json', 'Output status as JSON')
  .action(async (options) => {
    const { config, projectRoot, configPath } = await loadConfiguration(options.config);

    try {
      const logger = createLogger(config.logging?.level || 'info');
      const poltergeist = createPoltergeist(config, projectRoot, logger, configPath);
      const status = await poltergeist.getStatus(options.target);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(chalk.cyan(`${ghost.brand()} Poltergeist Status`));
        console.log(chalk.gray('═'.repeat(50)));

        if (options.target) {
          // Check if target exists in status
          const targetStatus = status[options.target];
          if (!targetStatus) {
            console.log(chalk.yellow(`Target '${options.target}' not found`));
          } else {
            formatTargetStatus(options.target, targetStatus, options.verbose);
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
        }
      }
    } catch (error) {
      console.error(chalk.red(poltergeistMessage('error', `Failed to get status: ${error}`)));
      process.exit(1);
    }
  });

interface StatusObject {
  status?: string;
  pid?: number; // Legacy format
  process?: {
    pid: number;
    hostname: string;
    isActive: boolean;
    lastHeartbeat?: string;
    startTime?: string;
  };
  lastBuild?: {
    timestamp: string;
    status: string;
    duration?: number;
    exitCode?: number;
    errorSummary?: string;
    gitHash?: string;
    builder?: string;
    error?: string;
  };
  app?: {
    bundleId?: string;
    runningPid?: number;
  };
  appInfo?: {
    bundleId?: string;
    outputPath?: string;
    iconPath?: string;
  };
  pendingFiles?: number;
  buildCommand?: string;
  buildStats?: {
    averageDuration: number;
    minDuration?: number;
    maxDuration?: number;
    successfulBuilds?: Array<{ duration: number; timestamp: string }>;
  };
}

function formatTargetStatus(name: string, status: unknown, verbose?: boolean): void {
  const statusObj = status as StatusObject;
  console.log(chalk.cyan(`Target: ${name}`));
  console.log(`  Status: ${formatStatus(statusObj.status || 'unknown')}`);

  // Process information
  if (statusObj.process) {
    const { pid, hostname, isActive, lastHeartbeat } = statusObj.process;
    if (isActive) {
      console.log(`  Process: ${chalk.green(`Running (PID: ${pid} on ${hostname})`)}`);
      const heartbeatAge = lastHeartbeat ? Date.now() - new Date(lastHeartbeat).getTime() : 0;
      const heartbeatStatus =
        heartbeatAge < 30000 ? chalk.green('✓ Active') : chalk.yellow('⚠ Stale');
      console.log(`  Heartbeat: ${heartbeatStatus} (${Math.round(heartbeatAge / 1000)}s ago)`);

      // Show uptime in verbose mode
      if (verbose && statusObj.process.startTime) {
        const uptime = Date.now() - new Date(statusObj.process.startTime).getTime();
        const uptimeMinutes = Math.floor(uptime / 60000);
        const uptimeSeconds = Math.floor((uptime % 60000) / 1000);
        console.log(`  Uptime: ${uptimeMinutes}m ${uptimeSeconds}s`);
      }
    } else {
      console.log(`  Process: ${chalk.gray('Not running')}`);
    }
  } else if (statusObj.pid) {
    // Legacy format
    console.log(`  Process: ${chalk.green(`Running (PID: ${statusObj.pid})`)}`);
  } else {
    console.log(`  Process: ${chalk.gray('Not running')}`);
  }

  // Build information
  if (statusObj.lastBuild) {
    console.log(`  Last Build: ${new Date(statusObj.lastBuild.timestamp).toLocaleString()}`);
    console.log(`  Build Status: ${formatStatus(statusObj.lastBuild.status)}`);

    // Show build command if building
    if (statusObj.lastBuild.status === 'building' && statusObj.buildCommand) {
      console.log(`  Command: ${statusObj.buildCommand}`);
    }

    if (statusObj.lastBuild.duration) {
      console.log(`  Build Time: ${statusObj.lastBuild.duration}ms`);
    }

    // Show elapsed time and estimate if building
    if (statusObj.lastBuild.status === 'building') {
      const elapsed = Date.now() - new Date(statusObj.lastBuild.timestamp).getTime();
      const elapsedSec = Math.round(elapsed / 1000);
      let timeInfo = `  Elapsed: ${elapsedSec}s`;

      // Add estimate if we have build statistics
      if (statusObj.buildStats?.averageDuration) {
        const avgSec = Math.round(statusObj.buildStats.averageDuration / 1000);
        const remainingSec = Math.max(0, avgSec - elapsedSec);
        timeInfo += ` / ~${avgSec}s (${remainingSec}s remaining)`;
      }

      console.log(timeInfo);
    }

    if (statusObj.lastBuild.gitHash) {
      console.log(`  Git Hash: ${statusObj.lastBuild.gitHash}`);
    }
    if (statusObj.lastBuild.builder) {
      console.log(`  Builder: ${statusObj.lastBuild.builder}`);
    }
    if (statusObj.lastBuild.errorSummary) {
      console.log(`  Error: ${chalk.red(statusObj.lastBuild.errorSummary)}`);
    } else if (statusObj.lastBuild.error) {
      console.log(`  Error: ${chalk.red(statusObj.lastBuild.error)}`);
    }

    // Show verbose build details
    if (verbose) {
      if (statusObj.lastBuild.exitCode !== undefined) {
        console.log(`  Exit Code: ${statusObj.lastBuild.exitCode}`);
      }
      if (statusObj.buildCommand) {
        console.log(`  Build Command: ${chalk.gray(statusObj.buildCommand)}`);
      }
    }
  }

  // App information
  if (statusObj.appInfo) {
    if (statusObj.appInfo.bundleId) {
      console.log(`  Bundle ID: ${statusObj.appInfo.bundleId}`);
    }
    if (statusObj.appInfo.outputPath) {
      console.log(`  Output: ${statusObj.appInfo.outputPath}`);
    }
    if (statusObj.appInfo.iconPath) {
      console.log(`  Icon: ${statusObj.appInfo.iconPath}`);
    }
  }

  // Build statistics (verbose mode)
  if (verbose && statusObj.buildStats) {
    console.log(chalk.gray('  Build Statistics:'));
    if (statusObj.buildStats.averageDuration) {
      console.log(
        `    Average Duration: ${Math.round(statusObj.buildStats.averageDuration / 1000)}s`
      );
    }
    if (statusObj.buildStats.minDuration !== undefined) {
      console.log(`    Min Duration: ${Math.round(statusObj.buildStats.minDuration / 1000)}s`);
    }
    if (statusObj.buildStats.maxDuration !== undefined) {
      console.log(`    Max Duration: ${Math.round(statusObj.buildStats.maxDuration / 1000)}s`);
    }
    if (statusObj.buildStats.successfulBuilds && statusObj.buildStats.successfulBuilds.length > 0) {
      console.log(`    Recent Successful Builds:`);
      statusObj.buildStats.successfulBuilds.slice(0, 3).forEach((build) => {
        const timestamp = new Date(build.timestamp).toLocaleTimeString();
        const duration = Math.round(build.duration / 1000);
        console.log(`      - ${timestamp}: ${duration}s`);
      });
    }
  }

  // Pending files
  if (statusObj.pendingFiles !== undefined && statusObj.pendingFiles > 0) {
    console.log(`  Pending Files: ${chalk.yellow(statusObj.pendingFiles)}`);
  }

  // Show agent instructions if not in TTY and building
  if (!process.stdout.isTTY && statusObj.lastBuild?.status === 'building') {
    console.log();
    if (statusObj.buildStats?.averageDuration) {
      const avgSec = Math.round(statusObj.buildStats.averageDuration / 1000);
      const recommendedTimeout = avgSec + 30; // Add 30s buffer
      console.log(`Use 'poltergeist wait ${name}' (timeout: ${recommendedTimeout}s recommended)`);
    } else {
      console.log(`Use 'poltergeist wait ${name}'`);
    }
    console.log(`Or 'poltergeist logs ${name} -f' for detailed output.`);
    console.log(`DO NOT run build commands manually unless build fails.`);
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'success':
      return chalk.green('✅ Success');
    case 'failure':
      return chalk.red('❌ Failed');
    case 'building':
      return chalk.yellow('🔨 Building');
    case 'watching':
      return chalk.blue('👀 Watching');
    default:
      return chalk.gray(status);
  }
}

// Log entry interface
interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  target?: string;
  [key: string]: unknown;
}

// Display logs with formatting and filtering
async function displayLogs(
  logFile: string,
  options: {
    target?: string;
    lines: string;
    follow?: boolean;
    json?: boolean;
  }
): Promise<void> {
  const maxLines = Number.parseInt(options.lines, 10);

  if (options.follow) {
    await followLogs(logFile, options.target, options.json);
    return;
  }

  // Read and parse log entries
  const logEntries = await readLogEntries(logFile, options.target, maxLines);

  if (logEntries.length === 0) {
    if (options.target) {
      console.log(chalk.yellow(`No logs found for target: ${options.target}`));
    } else {
      console.log(chalk.yellow('No logs found'));
    }
    return;
  }

  // Display logs
  if (options.json) {
    console.log(JSON.stringify(logEntries, null, 2));
  } else {
    console.log(chalk.cyan(`${ghost.brand()} Poltergeist Logs`));
    console.log(chalk.gray('═'.repeat(50)));
    logEntries.forEach(formatLogEntry);
  }
}

// Read and parse log entries from file
async function readLogEntries(
  logFile: string,
  targetFilter?: string,
  maxLines?: number
): Promise<LogEntry[]> {
  const content = readFileSync(logFile, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  const entries: LogEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;

      // Filter by target if specified
      if (targetFilter && entry.target !== targetFilter) {
        continue;
      }

      entries.push(entry);
    } catch (_error) {}
  }

  // Return last N lines if maxLines specified
  if (maxLines && entries.length > maxLines) {
    return entries.slice(-maxLines);
  }

  return entries;
}

// Format a single log entry for display
function formatLogEntry(entry: LogEntry): void {
  // Handle timestamp - Pino gives us HH:mm:ss format, so use it directly
  const timestamp = entry.timestamp.includes(':')
    ? entry.timestamp
    : new Date(entry.timestamp).toLocaleString();
  const level = formatLogLevel(entry.level);
  const target = entry.target ? chalk.blue(`[${entry.target}]`) : '';
  const message = entry.message;

  console.log(`${chalk.gray(timestamp)} ${level} ${target} ${message}`);

  // Show additional metadata if present
  const metadata: Record<string, unknown> = { ...entry };
  delete metadata.timestamp;
  delete metadata.level;
  delete metadata.message;
  delete metadata.target;

  const metadataKeys = Object.keys(metadata);
  if (metadataKeys.length > 0 && metadataKeys.some((key) => metadata[key] !== undefined)) {
    console.log(chalk.gray(`  ${JSON.stringify(metadata)}`));
  }
}

// Format log level with colors
function formatLogLevel(level: string): string {
  switch (level.toLowerCase()) {
    case 'error':
      return chalk.red('ERROR');
    case 'warn':
      return chalk.yellow('WARN ');
    case 'info':
      return chalk.cyan('INFO ');
    case 'debug':
      return chalk.gray('DEBUG');
    case 'success':
      return chalk.green('SUCCESS');
    default:
      return chalk.white(level.padEnd(5).toUpperCase());
  }
}

// Follow logs in real-time
async function followLogs(
  logFile: string,
  targetFilter?: string,
  jsonOutput?: boolean
): Promise<void> {
  let fileSize = statSync(logFile).size;

  console.log(chalk.cyan(`${ghost.brand()} Following Poltergeist logs... (Press Ctrl+C to exit)`));
  if (targetFilter) {
    console.log(chalk.gray(`Filtering for target: ${targetFilter}`));
  }
  console.log(chalk.gray('═'.repeat(50)));

  // Display existing logs first
  const existingEntries = await readLogEntries(logFile, targetFilter, 20);
  if (jsonOutput) {
    existingEntries.forEach((entry) => console.log(JSON.stringify(entry)));
  } else {
    existingEntries.forEach(formatLogEntry);
  }

  // Watch for new log entries
  watchFile(logFile, { interval: 500 }, (curr) => {
    if (curr.size > fileSize) {
      const stream = createReadStream(logFile, {
        start: fileSize,
        encoding: 'utf-8',
      });

      const rl = createInterface({
        input: stream,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      rl.on('line', (line) => {
        try {
          const entry = JSON.parse(line) as LogEntry;

          // Filter by target if specified
          if (targetFilter && entry.target !== targetFilter) {
            return;
          }

          if (jsonOutput) {
            console.log(JSON.stringify(entry));
          } else {
            formatLogEntry(entry);
          }
        } catch (_error) {
          // Skip malformed lines
        }
      });

      fileSize = curr.size;
    }
  });

  // Keep process alive
  return new Promise(() => {
    // This promise never resolves to keep the follow active
    // User exits with Ctrl+C
  });
}

program
  .command('init')
  .description('Initialize Poltergeist configuration for your project')
  .option('--cmake', 'Initialize for CMake project')
  .option('--auto', 'Auto-detect project type')
  .option('--preset <name>', 'Use specific CMake preset')
  .option('--generator <gen>', 'CMake generator to use')
  .option('--build-dir <dir>', 'Build directory', 'build')
  .option('--dry-run', 'Show what would be generated without creating config')
  .action(async (options) => {
    const projectRoot = process.cwd();
    const configPath = join(projectRoot, 'poltergeist.config.json');

    // Check if config already exists
    if (existsSync(configPath) && !options.dryRun) {
      console.error(chalk.red('❌ poltergeist.config.json already exists!'));
      console.error(chalk.yellow('Remove it first or use --dry-run to preview changes.'));
      process.exit(1);
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

    const configJson = JSON.stringify(config, null, 2);

    if (options.dryRun) {
      console.log(chalk.yellow('\n--dry-run mode, would create:'));
      console.log(chalk.gray('poltergeist.config.json:'));
      console.log(configJson);
    } else {
      writeFileSync(configPath, configJson, 'utf-8');
      console.log(chalk.green('✅ Created poltergeist.config.json'));

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
async function findXcodeProjects(
  rootPath: string,
  maxDepth: number = 2
): Promise<Array<{ path: string; type: 'xcodeproj' | 'xcworkspace'; scheme?: string }>> {
  const projects: Array<{ path: string; type: 'xcodeproj' | 'xcworkspace'; scheme?: string }> = [];

  async function scan(dir: string, depth: number) {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name.endsWith('.xcworkspace')) {
            projects.push({ path: fullPath, type: 'xcworkspace' });
          } else if (entry.name.endsWith('.xcodeproj')) {
            const scheme = entry.name.replace('.xcodeproj', '');
            projects.push({ path: fullPath, type: 'xcodeproj', scheme });
          } else if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await scan(fullPath, depth + 1);
          }
        }
      }
    } catch (_error) {
      // Ignore permission errors
    }
  }

  await scan(rootPath, 0);
  return projects;
}

// Helper to guess bundle ID from project
function guessBundleId(projectName: string, projectPath: string): string {
  // Common patterns
  const cleanName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/ios$/, '');

  const isIOS =
    projectName.toLowerCase().includes('ios') || projectPath.toLowerCase().includes('/ios/');

  // Try to extract from common patterns
  if (projectPath.includes('vibetunnel')) {
    return projectPath.includes('ios')
      ? 'sh.vibetunnel.vibetunnel.ios'
      : 'sh.vibetunnel.vibetunnel';
  }

  return isIOS ? `com.example.${cleanName}.ios` : `com.example.${cleanName}`;
}

// Helper function to generate default config for non-CMake projects
function generateDefaultConfig(projectType: ProjectType): PoltergeistConfig {
  const baseConfig: PoltergeistConfig = {
    version: '1.0',
    projectType,
    targets: [],
  };

  // Add default targets based on project type
  switch (projectType) {
    case 'node':
      baseConfig.targets.push({
        name: 'dev',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/index.js',
        watchPaths: ['src/**/*.{ts,js}', 'package.json'],
      });
      break;
    case 'rust':
      baseConfig.targets.push({
        name: 'debug',
        type: 'executable',
        buildCommand: 'cargo build',
        outputPath: './target/debug/app',
        watchPaths: ['src/**/*.rs', 'Cargo.toml'],
      });
      break;
    case 'python':
      baseConfig.targets.push({
        name: 'test',
        type: 'test',
        testCommand: 'python -m pytest',
        watchPaths: ['**/*.py', 'requirements.txt'],
      });
      break;
    case 'swift':
      baseConfig.targets.push({
        name: 'debug',
        type: 'executable',
        buildCommand: 'swift build',
        outputPath: '.build/debug/App',
        watchPaths: ['Sources/**/*.swift', 'Package.swift'],
      });
      break;
  }

  return baseConfig;
}

program
  .command('logs [target]')
  .description('Show Poltergeist logs')
  .option('-t, --tail <number>', 'Number of lines to show (default: 100)')
  .option('-f, --follow', 'Follow log output')
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output logs in JSON format')
  .action(async (targetName, options) => {
    const { config, projectRoot } = await loadConfiguration(options.config);

    // Handle smart defaults for log display
    let logTarget = targetName;

    if (!targetName) {
      // No target specified - need to be smart about it
      const logger = createLogger(config.logging?.level || 'info');
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

    const logFile = config.logging?.file || '.poltergeist.log';
    if (!existsSync(logFile)) {
      console.error(chalk.red(`No log file found: ${logFile}`));
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
    const { config } = await loadConfiguration(options.config);

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
    const { config, projectRoot } = await loadConfiguration(options.config);
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
      const timeout = Number.parseInt(options.timeout) * 1000;
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
    console.log(chalk.gray(poltergeistMessage('info', 'Cleaning up state files...')));

    const { StateManager } = await import('./state.js');
    const stateFiles = await StateManager.listAllStates();

    if (stateFiles.length === 0) {
      console.log(chalk.green('No state files found'));
      return;
    }

    const logger = createLogger();
    let removedCount = 0;
    const daysThreshold = Number.parseInt(options.days);
    const ageThreshold = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;

    for (const file of stateFiles) {
      try {
        const stateManager = new StateManager('/', logger);
        const targetName = file.replace('.state', '').split('-').pop() || '';
        const state = await stateManager.readState(targetName);

        if (!state) continue;

        let shouldRemove = false;
        let reason = '';

        if (options.all) {
          shouldRemove = true;
          reason = 'all files';
        } else if (!state.process.isActive) {
          const lastHeartbeat = new Date(state.process.lastHeartbeat).getTime();
          if (lastHeartbeat < ageThreshold) {
            shouldRemove = true;
            reason = `inactive for ${daysThreshold}+ days`;
          }
        }

        if (shouldRemove) {
          const projectName = state.projectName || 'unknown';
          const age = Math.round(
            (Date.now() - new Date(state.process.lastHeartbeat).getTime()) / (1000 * 60 * 60 * 24)
          );

          console.log(chalk.yellow(`  Removing: ${file}`));
          console.log(`    Project: ${projectName}`);
          console.log(`    Target: ${state.target}`);
          console.log(`    Age: ${age} days`);
          console.log(`    Reason: ${reason}`);

          if (!options.dryRun) {
            await stateManager.removeState(targetName);
            removedCount++;
          }
          console.log();
        }
      } catch (error) {
        console.error(chalk.red(`Error processing ${file}: ${error}`));
      }
    }

    if (options.dryRun) {
      console.log(chalk.blue(`Would remove ${removedCount} state file(s)`));
    } else {
      console.log(
        chalk.green(poltergeistMessage('success', `Removed ${removedCount} state file(s)`))
      );
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
    let parsedArgs;
    try {
      parsedArgs = JSON.parse(daemonArgs);
    } catch (error) {
      console.error('Failed to parse daemon arguments:', error);
      process.exit(1);
    }
    
    // Run daemon worker using static import (for Bun binary compatibility)
    runDaemon(parsedArgs).catch(error => {
      console.error('Failed to start daemon worker:', error);
      process.exit(1);
    });
  } else {
    console.error('Missing daemon arguments');
    process.exit(1);
  }
} else {
  // Parse arguments only when run directly (not when imported for testing)
  // Allow execution when imported by wrapper scripts (like poltergeist.ts)
  const isDirectRun = isMainModule();
  const isWrapperRun =
    process.argv[1]?.endsWith('poltergeist.ts') || process.argv[1]?.endsWith('poltergeist');

  if (isDirectRun || isWrapperRun) {
    program.parse(process.argv);

    // Show help if no command specified
    if (!process.argv.slice(2).length) {
      program.outputHelp();
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
