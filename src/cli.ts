#!/usr/bin/env node
// import { resolve } from 'path';
import chalk from 'chalk';
// Updated CLI for generic target system
import { Command } from 'commander';
import { createReadStream, existsSync, readFileSync, statSync, watchFile } from 'fs';
import { createInterface } from 'readline';
import packageJson from '../package.json' with { type: 'json' };
// import { Poltergeist } from './poltergeist.js';
import { ConfigurationError } from './config.js';
import { createPoltergeist } from './factories.js';
import { createLogger } from './logger.js';
import type { PoltergeistConfig } from './types.js';
import { ConfigurationManager } from './utils/config-manager.js';

const { version } = packageJson;

const program = new Command();

program
  .name('poltergeist')
  .description('👻 Poltergeist - The ghost that keeps your projects fresh')
  .version(version);

// Helper function to load config and handle errors
async function loadConfiguration(
  configPath?: string
): Promise<{ config: PoltergeistConfig; projectRoot: string }> {
  try {
    const result = await ConfigurationManager.getConfig(configPath);
    return { config: result.config, projectRoot: result.projectRoot };
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(chalk.red(error.message));
    } else {
      console.error(chalk.red(`Failed to load configuration: ${error}`));
    }
    process.exit(1);
  }
}

// Helper to get target names from config
function getTargetNames(config: PoltergeistConfig): string[] {
  return config.targets.map((t) => t.name);
}

// Helper to format target list
function formatTargetList(config: PoltergeistConfig): string {
  return config.targets
    .map(
      (t) => `  - ${chalk.cyan(t.name)} (${t.type})${t.enabled ? '' : chalk.gray(' [disabled]')}`
    )
    .join('\n');
}

program
  .command('haunt')
  .alias('start')
  .description('Start watching and auto-building your project')
  .option('-t, --target <name>', 'Target to build (omit to build all enabled targets)')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    console.log(chalk.gray('👻 [Poltergeist] Summoning Poltergeist to watch your project...'));

    const { config, projectRoot } = await loadConfiguration(options.config);

    // Validate target if specified
    if (options.target) {
      const targetNames = getTargetNames(config);
      if (!targetNames.includes(options.target)) {
        console.error(chalk.red(`Unknown target: ${options.target}`));
        console.error(chalk.yellow('Available targets:'));
        console.error(formatTargetList(config));
        process.exit(1);
      }
      console.log(chalk.gray(`👻 [Poltergeist] Building target: ${options.target}`));
    } else {
      const enabledTargets = config.targets.filter((t) => t.enabled);
      if (enabledTargets.length === 0) {
        console.error(chalk.red('No enabled targets found in configuration'));
        process.exit(1);
      }
      console.log(
        chalk.gray(`👻 [Poltergeist] Building ${enabledTargets.length} enabled target(s)`)
      );
    }

    // Create logger
    const logger = createLogger(
      config.logging?.file || '.poltergeist.log',
      config.logging?.level || 'info'
    );

    try {
      const poltergeist = createPoltergeist(config, projectRoot, logger);
      await poltergeist.start(options.target);
    } catch (error) {
      console.error(chalk.red(`👻 [Poltergeist] Failed to start Poltergeist: ${error}`));
      process.exit(1);
    }
  });

program
  .command('stop')
  .alias('rest')
  .description('Stop Poltergeist')
  .option('-t, --target <name>', 'Stop specific target only')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    console.log(chalk.gray('👻 [Poltergeist] Putting Poltergeist to rest...'));

    const { config, projectRoot } = await loadConfiguration(options.config);

    try {
      const logger = createLogger(config.logging?.level || 'info');
      const poltergeist = createPoltergeist(config, projectRoot, logger);
      await poltergeist.stop(options.target);
      console.log(chalk.green('👻 [Poltergeist] Poltergeist is now at rest'));
    } catch (error) {
      console.error(chalk.red(`👻 [Poltergeist] Failed to stop: ${error}`));
      process.exit(1);
    }
  });

program
  .command('restart')
  .description('Restart Poltergeist (stop and start again)')
  .option('-t, --target <name>', 'Restart specific target only')
  .option('-c, --config <path>', 'Path to config file')
  .option('-n, --no-cache', 'Clear Watchman cache on restart')
  .action(async (options) => {
    console.log(chalk.gray('👻 [Poltergeist] Restarting...'));

    const { config, projectRoot } = await loadConfiguration(options.config);
    const logger = createLogger(config.logging?.level || 'info');

    try {
      // First stop Poltergeist
      console.log(chalk.gray('👻 [Poltergeist] Stopping current instance...'));
      const poltergeist = createPoltergeist(config, projectRoot, logger);
      await poltergeist.stop(options.target);
      
      // Wait a moment to ensure clean shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Clear Watchman cache if requested
      if (!options.cache) {
        console.log(chalk.gray('👻 [Poltergeist] Clearing Watchman cache...'));
        try {
          const { execSync } = await import('child_process');
          execSync('watchman watch-del-all', { stdio: 'ignore' });
        } catch (error) {
          logger.warn('Failed to clear Watchman cache:', error);
        }
      }
      
      // Then start it again as a detached process
      console.log(chalk.gray(`👻 [Poltergeist] Starting new instance... v${version}`));
      
      // Build the start command
      const startArgs = ['start'];
      if (options.target) {
        startArgs.push('--target', options.target);
      }
      if (options.config) {
        startArgs.push('--config', options.config);
      }
      
      // Spawn detached process
      const { spawn } = await import('child_process');
      const child = spawn('node', [process.argv[1], ...startArgs], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd()
      });
      
      // Detach the child process
      child.unref();
      
      console.log(chalk.green(`👻 [Poltergeist] Successfully restarted! (PID: ${child.pid})`));
    } catch (error) {
      console.error(chalk.red(`👻 [Poltergeist] Failed to restart: ${error}`));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check Poltergeist status')
  .option('-t, --target <name>', 'Check specific target status')
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output status as JSON')
  .action(async (options) => {
    const { config, projectRoot } = await loadConfiguration(options.config);

    try {
      const logger = createLogger(config.logging?.level || 'info');
      const poltergeist = createPoltergeist(config, projectRoot, logger);
      const status = await poltergeist.getStatus(options.target);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(chalk.blue('👻 Poltergeist Status'));
        console.log(chalk.gray('═'.repeat(50)));

        if (options.target) {
          // Single target status
          const targetStatus = status[options.target];
          if (!targetStatus) {
            console.log(chalk.red(`Target '${options.target}' not found`));
          } else {
            formatTargetStatus(options.target, targetStatus);
          }
        } else {
          // All targets status
          const targets = Object.keys(status).filter(key => !key.startsWith('_'));
          if (targets.length === 0) {
            console.log(chalk.gray('No targets configured'));
          } else {
            targets.forEach((name) => {
              formatTargetStatus(name, status[name]);
              console.log(); // Empty line between targets
            });
          }
        }
      }
    } catch (error) {
      console.error(chalk.red(`👻 [Poltergeist] Failed to get status: ${error}`));
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
}

function formatTargetStatus(name: string, status: unknown): void {
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
    if (statusObj.lastBuild.duration) {
      console.log(`  Build Time: ${statusObj.lastBuild.duration}ms`);
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

  // Pending files
  if (statusObj.pendingFiles !== undefined && statusObj.pendingFiles > 0) {
    console.log(`  Pending Files: ${chalk.yellow(statusObj.pendingFiles)}`);
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
async function displayLogs(logFile: string, options: {
  target?: string;
  lines: string;
  follow?: boolean;
  json?: boolean;
}): Promise<void> {
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
    console.log(chalk.blue('👻 Poltergeist Logs'));
    console.log(chalk.gray('═'.repeat(50)));
    logEntries.forEach(formatLogEntry);
  }
}

// Read and parse log entries from file
async function readLogEntries(logFile: string, targetFilter?: string, maxLines?: number): Promise<LogEntry[]> {
  const content = readFileSync(logFile, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim());
  
  const entries: LogEntry[] = [];
  
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      
      // Filter by target if specified
      if (targetFilter && entry.target !== targetFilter) {
        continue;
      }
      
      entries.push(entry);
    } catch (error) {
      // Skip malformed log lines
      continue;
    }
  }

  // Return last N lines if maxLines specified
  if (maxLines && entries.length > maxLines) {
    return entries.slice(-maxLines);
  }
  
  return entries;
}

// Format a single log entry for display
function formatLogEntry(entry: LogEntry): void {
  // Handle timestamp - winston gives us HH:mm:ss format, so use it directly
  const timestamp = entry.timestamp.includes(':') ? entry.timestamp : new Date(entry.timestamp).toLocaleString();
  const level = formatLogLevel(entry.level);
  const target = entry.target ? chalk.blue(`[${entry.target}]`) : '';
  const message = entry.message;
  
  console.log(`${chalk.gray(timestamp)} ${level} ${target} ${message}`);
  
  // Show additional metadata if present
  const metadata = { ...entry };
  delete (metadata as any).timestamp;
  delete (metadata as any).level;
  delete (metadata as any).message;
  delete (metadata as any).target;
  
  const metadataKeys = Object.keys(metadata);
  if (metadataKeys.length > 0 && metadataKeys.some(key => metadata[key] !== undefined)) {
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
async function followLogs(logFile: string, targetFilter?: string, jsonOutput?: boolean): Promise<void> {
  let fileSize = statSync(logFile).size;
  
  console.log(chalk.blue('👻 Following Poltergeist logs... (Press Ctrl+C to exit)'));
  if (targetFilter) {
    console.log(chalk.gray(`Filtering for target: ${targetFilter}`));
  }
  console.log(chalk.gray('═'.repeat(50)));
  
  // Display existing logs first
  const existingEntries = await readLogEntries(logFile, targetFilter, 20);
  if (jsonOutput) {
    existingEntries.forEach(entry => console.log(JSON.stringify(entry)));
  } else {
    existingEntries.forEach(formatLogEntry);
  }
  
  // Watch for new log entries
  watchFile(logFile, { interval: 500 }, (curr) => {
    if (curr.size > fileSize) {
      const stream = createReadStream(logFile, {
        start: fileSize,
        encoding: 'utf-8'
      });
      
      const rl = createInterface({
        input: stream,
        crlfDelay: Infinity
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
        } catch (error) {
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
  .command('logs')
  .description('Show Poltergeist logs')
  .option('-t, --target <name>', 'Show logs for specific target')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('-f, --follow', 'Follow log output')
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output logs in JSON format')
  .action(async (options) => {
    const { config } = await loadConfiguration(options.config);

    const logFile = config.logging?.file || '.poltergeist.log';
    if (!existsSync(logFile)) {
      console.error(chalk.red(`No log file found: ${logFile}`));
      console.error(chalk.yellow('💡 Start Poltergeist to generate logs: poltergeist start'));
      process.exit(1);
    }

    try {
      await displayLogs(logFile, options);
    } catch (error) {
      console.error(chalk.red(`Failed to read logs: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all configured targets')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const { config } = await loadConfiguration(options.config);

    console.log(chalk.blue('👻 Configured Targets'));
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
  .command('clean')
  .description('Clean up stale state files')
  .option('-a, --all', 'Remove all state files, not just stale ones')
  .option('-d, --days <number>', 'Remove state files older than N days', '7')
  .option('--dry-run', 'Show what would be removed without actually removing')
  .action(async (options) => {
    console.log(chalk.gray('👻 [Poltergeist] Cleaning up state files...'));

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
      console.log(chalk.green(`👻 [Poltergeist] Removed ${removedCount} state file(s)`));
    }
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

// Parse arguments only when run directly (not when imported for testing)
// Allow execution when imported by wrapper scripts (like poltergeist.ts)
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
const isWrapperRun = process.argv[1]?.endsWith('poltergeist.ts') || process.argv[1]?.endsWith('poltergeist');

if (isDirectRun || isWrapperRun) {
  program.parse(process.argv);

  // Show help if no command specified
  if (!process.argv.slice(2).length) {
    program.outputHelp();
  }
}

// Export program for testing
export { program };
// Trigger rebuild
// Test file watching
// Test file watching Wed Jul 30 20:26:08 CEST 2025
// Another test Wed Jul 30 20:26:59 CEST 2025
// Testing file change logging in build messages - testing both fixes!
