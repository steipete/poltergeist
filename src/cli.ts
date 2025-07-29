#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createLogger, createConsoleLogger } from './logger.js';
import { Poltergeist, loadConfig } from './poltergeist.js';

const program = new Command();
const console = createConsoleLogger();

// Version from package.json
const packageJson = await import('../package.json', { with: { type: 'json' } });

program
  .name('poltergeist')
  .description('The ghost that keeps your Swift projects fresh')
  .version(packageJson.default.version);

program
  .command('haunt')
  .alias('start')
  .description('Start watching and auto-building your Swift project')
  .option('--cli', 'Watch only CLI targets')
  .option('--mac', 'Watch only Mac app targets')
  .option('--all', 'Watch all targets (default)')
  .option('-c, --config <path>', 'Path to config file', './poltergeist.config.json')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      // Determine mode
      let mode: 'cli' | 'mac' | 'all' = 'all';
      if (options.cli) mode = 'cli';
      else if (options.mac) mode = 'mac';

      // Find project root (where config file is)
      const configPath = path.resolve(options.config);
      const projectRoot = path.dirname(configPath);

      if (!existsSync(configPath)) {
        console.error(`Config file not found: ${configPath}`);
        console.info('Run "poltergeist init" to create a config file');
        process.exit(1);
      }

      // Load config
      const config = await loadConfig(configPath);

      // Create logger
      const logger = createLogger(
        path.join(projectRoot, config.logging.file),
        options.verbose ? 'debug' : config.logging.level
      );

      // Create and start Poltergeist
      const poltergeist = new Poltergeist(config, projectRoot, logger, mode);

      console.info('Summoning Poltergeist to watch your Swift files...');
      console.info(`Starting in ${mode.toUpperCase()} mode`);

      await poltergeist.start();

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.info('\nReceived SIGINT, stopping Poltergeist...');
        await poltergeist.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.info('\nReceived SIGTERM, stopping Poltergeist...');
        await poltergeist.stop();
        process.exit(0);
      });

    } catch (error) {
      console.error(`Failed to start Poltergeist: ${error}`);
      process.exit(1);
    }
  });

program
  .command('rest')
  .alias('stop')
  .description('Stop all Poltergeist watchers')
  .action(async () => {
    console.info('Sending all Poltergeist instances to rest...');
    
    try {
      // In the TypeScript version, we rely on process management
      // rather than checking for lock files
      console.success('Use Ctrl+C in the running Poltergeist process to stop it');
    } catch (error) {
      console.error(`Failed to stop Poltergeist: ${error}`);
    }
  });

program
  .command('status')
  .description('Show Poltergeist status')
  .option('-c, --config <path>', 'Path to config file', './poltergeist.config.json')
  .action(async (options) => {
    try {
      const configPath = path.resolve(options.config);
      
      if (!existsSync(configPath)) {
        console.warn('No config file found. Poltergeist is not configured.');
        return;
      }

      const config = await loadConfig(configPath);

      console.info(chalk.magenta('\n=== Poltergeist Status ===\n'));

      // Check each target
      if (config.cli?.enabled) {
        console.info(chalk.cyan('CLI Target:'));
        if (existsSync(config.cli.statusFile)) {
          const { readFile } = await import('fs/promises');
          const statusContent = await readFile(config.cli.statusFile, 'utf8');
          const status = JSON.parse(statusContent);
          console.info(`  Status: ${status.status}`);
          console.info(`  Last build: ${status.timestamp}`);
          if (status.buildTime) {
            console.info(`  Build time: ${(status.buildTime / 1000).toFixed(1)}s`);
          }
        } else {
          console.info('  Status: No builds yet');
        }
        console.info(`  Watch paths: ${config.cli.watchPaths.join(', ')}`);
      }

      if (config.macApp?.enabled) {
        console.info(chalk.cyan('\nMac App Target:'));
        if (existsSync(config.macApp.statusFile)) {
          const { readFile } = await import('fs/promises');
          const statusContent = await readFile(config.macApp.statusFile, 'utf8');
          const status = JSON.parse(statusContent);
          console.info(`  Status: ${status.status}`);
          console.info(`  Last build: ${status.timestamp}`);
          if (status.buildTime) {
            console.info(`  Build time: ${(status.buildTime / 1000).toFixed(1)}s`);
          }
        } else {
          console.info('  Status: No builds yet');
        }
        console.info(`  Watch paths: ${config.macApp.watchPaths.join(', ')}`);
        console.info(`  Auto-relaunch: ${config.macApp.autoRelaunch ? 'Yes' : 'No'}`);
      }

    } catch (error) {
      console.error(`Failed to get status: ${error}`);
    }
  });

program
  .command('init')
  .description('Create a Poltergeist config file')
  .option('-f, --force', 'Overwrite existing config')
  .action(async (options) => {
    const configPath = path.resolve('./poltergeist.config.json');
    
    if (existsSync(configPath) && !options.force) {
      console.error('Config file already exists. Use --force to overwrite.');
      process.exit(1);
    }

    const defaultConfig = {
      cli: {
        enabled: true,
        buildCommand: './scripts/build-swift-debug.sh',
        outputPath: './my-cli',
        statusFile: '/tmp/my-cli-build-status.json',
        lockFile: '/tmp/my-cli-build.lock',
        watchPaths: [
          'Sources/**/*.swift',
          'Package.swift',
          'Package.resolved'
        ],
        settlingDelay: 1000,
        maxRetries: 3,
        backoffMultiplier: 2
      },
      macApp: {
        enabled: false,
        buildCommand: 'xcodebuild -workspace MyApp.xcworkspace -scheme MyApp -configuration Debug build',
        bundleId: 'com.example.myapp',
        statusFile: '/tmp/my-app-build-status.json',
        lockFile: '/tmp/my-app-build.lock',
        autoRelaunch: true,
        watchPaths: [
          'MyApp/**/*.swift',
          'MyApp/**/*.storyboard',
          'MyApp/**/*.xib'
        ],
        settlingDelay: 1000,
        maxRetries: 3,
        backoffMultiplier: 2
      },
      notifications: {
        enabled: true,
        successSound: 'Glass',
        failureSound: 'Basso'
      },
      logging: {
        file: '.poltergeist.log',
        level: 'info'
      }
    };

    const { writeFile } = await import('fs/promises');
    await writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
    
    console.success(`Created config file: ${configPath}`);
    console.info('Edit the config file to match your project structure');
  });

program.parse(process.argv);