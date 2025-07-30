#!/usr/bin/env node
// Updated CLI for generic target system
import { Command } from 'commander';
import { existsSync } from 'fs';
// import { resolve } from 'path';
import chalk from 'chalk';
import { Poltergeist } from './poltergeist.js';
import { ConfigLoader, ConfigurationError } from './config.js';
import { createLogger } from './logger.js';
import { PoltergeistConfig } from './types.js';
import packageJson from '../package.json' with { type: 'json' };
const { version } = packageJson;

const program = new Command();

program
  .name('poltergeist')
  .description('The ghost that keeps your projects fresh')
  .version(version);

// Helper function to load config and handle errors
async function loadConfiguration(configPath: string): Promise<{ config: PoltergeistConfig; projectRoot: string }> {
  try {
    const loader = new ConfigLoader(configPath);
    const config = loader.loadConfig();
    return { config, projectRoot: loader.getProjectRoot() };
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
  return config.targets.map(t => t.name);
}

// Helper to format target list
function formatTargetList(config: PoltergeistConfig): string {
  return config.targets
    .map(t => `  - ${chalk.cyan(t.name)} (${t.type})${t.enabled ? '' : chalk.gray(' [disabled]')}`)
    .join('\n');
}

program
  .command('haunt')
  .alias('start')
  .description('Start watching and auto-building your project')
  .option('-t, --target <name>', 'Target to build (omit to build all enabled targets)')
  .option('-c, --config <path>', 'Path to config file', './poltergeist.config.json')
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
      const enabledTargets = config.targets.filter(t => t.enabled);
      if (enabledTargets.length === 0) {
        console.error(chalk.red('No enabled targets found in configuration'));
        process.exit(1);
      }
      console.log(chalk.gray(`👻 [Poltergeist] Building ${enabledTargets.length} enabled target(s)`));
    }
    
    // Create logger
    const logger = createLogger(
      config.logging?.file || '.poltergeist.log',
      config.logging?.level || 'info'
    );
    
    try {
      const poltergeist = new Poltergeist(config, projectRoot, logger);
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
  .option('-c, --config <path>', 'Path to config file', './poltergeist.config.json')
  .action(async (options) => {
    console.log(chalk.gray('👻 [Poltergeist] Putting Poltergeist to rest...'));
    
    const { config, projectRoot } = await loadConfiguration(options.config);
    
    try {
      const poltergeist = new Poltergeist(config, projectRoot);
      await poltergeist.stop(options.target);
      console.log(chalk.green('👻 [Poltergeist] Poltergeist is now at rest'));
    } catch (error) {
      console.error(chalk.red(`👻 [Poltergeist] Failed to stop: ${error}`));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check Poltergeist status')
  .option('-t, --target <name>', 'Check specific target status')
  .option('-c, --config <path>', 'Path to config file', './poltergeist.config.json')
  .option('--json', 'Output status as JSON')
  .action(async (options) => {
    const { config, projectRoot } = await loadConfiguration(options.config);
    
    try {
      const poltergeist = new Poltergeist(config, projectRoot);
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
          const targets = Object.keys(status);
          if (targets.length === 0) {
            console.log(chalk.gray('No targets configured'));
          } else {
            targets.forEach(name => {
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

function formatTargetStatus(name: string, status: any): void {
  console.log(chalk.cyan(`Target: ${name}`));
  console.log(`  Status: ${formatStatus(status.status)}`);
  
  if (status.pid) {
    console.log(`  Process: ${chalk.green(`Running (PID: ${status.pid})`)}`);
  } else {
    console.log(`  Process: ${chalk.gray('Not running')}`);
  }
  
  if (status.lastBuild) {
    console.log(`  Last Build: ${new Date(status.lastBuild.timestamp).toLocaleString()}`);
    console.log(`  Build Status: ${formatStatus(status.lastBuild.status)}`);
    if (status.lastBuild.duration) {
      console.log(`  Build Time: ${status.lastBuild.duration}ms`);
    }
    if (status.lastBuild.error) {
      console.log(`  Error: ${chalk.red(status.lastBuild.error)}`);
    }
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

program
  .command('logs')
  .description('Show Poltergeist logs')
  .option('-t, --target <name>', 'Show logs for specific target')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('-f, --follow', 'Follow log output')
  .option('-c, --config <path>', 'Path to config file', './poltergeist.config.json')
  .action(async (options) => {
    const { config } = await loadConfiguration(options.config);
    
    const logFile = config.logging?.file || '.poltergeist.log';
    if (!existsSync(logFile)) {
      console.error(chalk.red('No log file found'));
      process.exit(1);
    }
    
    // This would normally use tail command or similar
    console.log(chalk.yellow('Log viewing implementation needed'));
  });

program
  .command('list')
  .description('List all configured targets')
  .option('-c, --config <path>', 'Path to config file', './poltergeist.config.json')
  .action(async (options) => {
    const { config } = await loadConfiguration(options.config);
    
    console.log(chalk.blue('👻 Configured Targets'));
    console.log(chalk.gray('═'.repeat(50)));
    
    if (config.targets.length === 0) {
      console.log(chalk.gray('No targets configured'));
    } else {
      config.targets.forEach(target => {
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

// Parse arguments
program.parse(process.argv);

// Show help if no command specified
if (!process.argv.slice(2).length) {
  program.outputHelp();
}