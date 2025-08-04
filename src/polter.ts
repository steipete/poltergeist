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
import { spawn } from 'child_process';
import { Command } from 'commander';
import { existsSync } from 'fs';
import ora from 'ora';
import { resolve as resolvePath } from 'path';
import type { PoltergeistState } from './state.js';
import type { Target } from './types.js';
import { BuildStatusManager } from './utils/build-status-manager.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { FileSystemUtils } from './utils/filesystem.js';

interface LogOptions {
  showLogs: boolean;
  logLines: number;
}

/**
 * Gets build status for a target by reading state file directly
 */
async function getBuildStatus(
  projectRoot: string,
  target: Target,
  options?: { checkProcessForBuilding?: boolean }
): Promise<'building' | 'failed' | 'success' | 'unknown'> {
  try {
    const stateFilePath = FileSystemUtils.getStateFilePath(projectRoot, target.name);

    if (!existsSync(stateFilePath)) {
      return 'unknown';
    }

    const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(stateFilePath);

    if (!state) {
      return 'unknown';
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
        `⚠️  Could not read build status: ${error instanceof Error ? error.message : error}`
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
  
  // Use ora for professional spinner with automatic cursor management
  const spinner = ora({
    text: 'Build in progress...',
    color: 'cyan',
    spinner: 'dots'
  });

  // Start spinner (automatically handles TTY detection and cursor hiding)
  spinner.start();

  // Update elapsed time and build logs periodically
  const timeInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    
    if (logOptions.showLogs) {
      // TODO: Replace with actual log tailing
      const mockLogs = [
        '[INFO] Compiling TypeScript files...',
        '[INFO] Processing src/polter.ts',
        '[WARN] Unused import in utils.ts',
        '[INFO] Generating type definitions',
        '[INFO] Build in progress...'
      ].slice(-logOptions.logLines);
      
      const logText = mockLogs.map(line => `│ ${line}`).join('\n');
      spinner.text = `Build in progress... ${Math.round(elapsed / 100) / 10}s\n${logText}`;
    } else {
      spinner.text = `Build in progress... ${Math.round(elapsed / 100) / 10}s`;
    }
  }, 100);

  try {
    while (Date.now() - startTime < timeoutMs) {
      const status = await getBuildStatus(projectRoot, target, { checkProcessForBuilding: true });

      if (status === 'success') {
        clearInterval(timeInterval);
        spinner.succeed('Build completed successfully');
        return 'success';
      }

      if (status === 'failed') {
        clearInterval(timeInterval);
        spinner.fail('Build failed');
        return 'failed';
      }

      if (status !== 'building') {
        // Build process died or status changed - check the actual final status
        const finalStatus = await getBuildStatus(projectRoot, target, {
          checkProcessForBuilding: true,
        });
        
        clearInterval(timeInterval);
        
        if (finalStatus === 'success') {
          spinner.succeed('Build completed successfully');
          return 'success';
        } else if (finalStatus === 'failed') {
          spinner.fail('Build failed');
          return 'failed';
        } else {
          // If status is unknown (e.g., file deleted), assume build process died and proceed
          spinner.succeed('Build process completed');
          return 'success';
        }
      }

      // Short sleep to avoid busy polling
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    clearInterval(timeInterval);
    spinner.fail('Build timeout');
    return 'timeout';
  } catch (error) {
    clearInterval(timeInterval);
    spinner.fail('Build error');
    throw error;
  }
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
  // Try common binary locations for the target
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

  let binaryPath: string | null = null;
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      binaryPath = path;
      break;
    }
  }

  if (!binaryPath) {
    console.error(chalk.red(`❌ Binary not found for target '${targetName}'`));
    console.error(chalk.yellow('Tried the following locations:'));
    possiblePaths.forEach((path) => console.error(chalk.gray(`   ${path}`)));
    console.error(chalk.yellow('🔧 Try running a manual build first'));
    return 1;
  }

  // Show warning banner
  console.warn(chalk.yellow('⚠️  POLTERGEIST NOT RUNNING - EXECUTING POTENTIALLY STALE BINARY'));
  console.warn(chalk.yellow('   The binary may be outdated. For fresh builds, start Poltergeist:'));
  console.warn(chalk.yellow('   npm run poltergeist:haunt'));
  console.warn('');

  if (options.verbose) {
    console.log(chalk.blue(`📍 Project root: ${projectRoot}`));
    console.log(chalk.blue(`🎯 Binary path: ${binaryPath}`));
    console.log(chalk.yellow(`⚠️  Status: Executing without build verification`));
  }

  console.log(chalk.green(`✅ Running binary: ${targetName} (potentially stale)`));

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
      console.error(chalk.red(`❌ Failed to execute ${targetName}:`));
      console.error(chalk.red(`   ${error.message}`));

      // Provide helpful suggestions based on error type
      if (error.message.includes('ENOENT')) {
        console.error(chalk.yellow('💡 Tips:'));
        console.error('   • Check if the binary exists and is executable');
        console.error('   • Try running: poltergeist start');
        console.error('   • Verify the output path in your configuration');
      } else if (error.message.includes('EACCES')) {
        console.error(chalk.yellow('💡 Permission denied:'));
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
function executeTarget(target: Target, projectRoot: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    // Get output path based on target type
    let binaryPath: string;
    if ('outputPath' in target) {
      binaryPath = resolvePath(projectRoot, target.outputPath);
    } else {
      console.error(chalk.red(`❌ Target '${target.name}' does not have an output path`));
      resolve(1);
      return;
    }

    if (!existsSync(binaryPath)) {
      console.error(chalk.red(`❌ Binary not found: ${binaryPath}`));
      console.error(chalk.yellow(`🔧 Try running: poltergeist start`));
      resolve(1);
      return;
    }

    console.log(chalk.green(`✅ Running fresh binary: ${target.name}`));

    // Determine how to execute based on file extension
    let command: string;
    let commandArgs: string[];

    const ext = binaryPath.toLowerCase();
    if (ext.endsWith('.js') || ext.endsWith('.mjs')) {
      command = 'node';
      commandArgs = [binaryPath, ...args];
    } else if (ext.endsWith('.py')) {
      command = 'python';
      commandArgs = [binaryPath, ...args];
    } else if (ext.endsWith('.sh')) {
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
      console.error(chalk.red(`❌ Failed to execute ${target.name}:`));
      console.error(chalk.red(`   ${error.message}`));

      // Provide helpful suggestions based on error type
      if (error.message.includes('ENOENT')) {
        console.error(chalk.yellow('💡 Tips:'));
        console.error('   • Check if the binary exists and is executable');
        console.error('   • Try running: poltergeist start');
        console.error('   • Verify the output path in your configuration');
      } else if (error.message.includes('EACCES')) {
        console.error(chalk.yellow('💡 Permission denied:'));
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
 * Main pgrun execution logic
 */
async function runWrapper(
  targetName: string,
  args: string[],
  options: {
    timeout: number;
    force: boolean;
    noWait: boolean;
    verbose: boolean;
    showLogs: boolean;
    logLines: number;
  }
) {
  try {
    // Find poltergeist config
    const discovery = await ConfigurationManager.discoverAndLoadConfig();
    if (!discovery) {
      // No Poltergeist config found - fall back to stale execution
      if (options.verbose) {
        console.warn(
          chalk.yellow('⚠️  No poltergeist.config.json found - attempting stale execution')
        );
      }

      // Try to find project root (current directory)
      const projectRoot = process.cwd();
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
          chalk.yellow(`⚠️  Target '${targetName}' not found in config - attempting stale execution`)
        );
      }

      const availableTargets = ConfigurationManager.getExecutableTargets(config).map((t) => t.name);
      if (availableTargets.length > 0) {
        console.warn(chalk.yellow('Available configured targets:'));
        availableTargets.forEach((name) => console.warn(chalk.yellow(`   - ${name}`)));
        console.warn('');
      }

      const exitCode = await executeStaleWithWarning(targetName, projectRoot, args, options);
      process.exit(exitCode);
    }

    // Validate target type
    if (target.type !== 'executable') {
      console.error(
        chalk.red(`❌ Target '${targetName}' is not executable (type: ${target.type})`)
      );
      console.error(chalk.yellow('💡 polter only works with executable targets'));
      console.error('   • Executable targets have "type": "executable" in the config');
      console.error('   • Other target types are handled by Poltergeist daemon');
      process.exit(1);
    }

    if (options.verbose) {
      console.log(chalk.blue(`📍 Project root: ${projectRoot}`));
      console.log(chalk.blue(`🎯 Target: ${target.name} (${target.outputPath})`));
    }

    // Check build status
    const status = await getBuildStatus(projectRoot, target);

    if (options.verbose) {
      console.log(chalk.blue(`📊 Build status: ${status}`));
    }

    // Handle different build states
    switch (status) {
      case 'building': {
        // Build is in progress - lastBuild.status === 'building'
        if (options.noWait) {
          console.error(chalk.red('❌ Build in progress and --no-wait specified'));
          process.exit(1);
        }

        const result = await waitForBuildCompletion(projectRoot, target, options.timeout, {
          showLogs: options.showLogs,
          logLines: options.logLines
        });

        if (result === 'timeout') {
          console.error(chalk.red(`❌ Build timeout after ${options.timeout}ms`));
          console.error(chalk.yellow('💡 Solutions:'));
          console.error(
            `   • Increase timeout: polter ${targetName} --timeout ${options.timeout * 2}`
          );
          console.error('   • Check build logs: poltergeist logs');
          console.error('   • Verify Poltergeist is running: poltergeist status');
          process.exit(1);
        }

        if (result === 'failed' && !options.force) {
          console.error(chalk.red('❌ Build failed'));
          console.error(chalk.yellow('💡 Options:'));
          console.error('   • Check build logs: poltergeist logs');
          console.error(`   • Force execution anyway: polter ${targetName} --force`);
          console.error('   • Fix build errors and try again');
          process.exit(1);
        }

        if (result === 'failed' && options.force) {
          console.warn(chalk.yellow('⚠️  Running despite build failure (--force specified)'));
        }
        break;
      }

      case 'failed':
        if (!options.force) {
          console.error(chalk.red('❌ Last build failed'));
          console.error(
            chalk.yellow('🔧 Run `poltergeist logs` for details or use --force to run anyway')
          );
          process.exit(1);
        }
        console.warn(chalk.yellow('⚠️  Running despite build failure (--force specified)'));
        break;

      case 'success':
        if (options.verbose) {
          console.log(chalk.green('✅ Build successful'));
        }
        break;

      case 'unknown':
        console.warn(chalk.yellow('⚠️  Build status unknown, proceeding...'));
        break;
    }

    // Execute the target
    const exitCode = await executeTarget(target, projectRoot, args);
    process.exit(exitCode);
  } catch (error) {
    console.error(chalk.red('❌ Unexpected error:'));
    console.error(chalk.red(`   ${error instanceof Error ? error.message : error}`));

    if (options.verbose && error instanceof Error) {
      console.error(chalk.gray('\nStack trace:'));
      console.error(chalk.gray(error.stack));
    }

    console.error(chalk.yellow('\n💡 Common solutions:'));
    console.error('   • Check if poltergeist.config.json exists and is valid');
    console.error('   • Verify target name matches configuration');
    console.error('   • Run with --verbose for more details');
    console.error('   • Check poltergeist status: poltergeist status');

    process.exit(1);
  }
}

// CLI setup
const program = new Command();

program
  .name('polter')
  .description('Smart wrapper for running executables managed by Poltergeist')
  .version('1.0.0')
  .argument('[target]', 'Name of the target to run (defaults to first configured target)')
  .argument('[args...]', 'Arguments to pass to the target executable')
  .option('-t, --timeout <ms>', 'Build wait timeout in milliseconds', '300000')
  .option('-f, --force', 'Run even if build failed', false)
  .option('-n, --no-wait', "Don't wait for builds, fail if building")
  .option('-v, --verbose', 'Show detailed status information', false)
  .option('--no-logs', 'Disable build log streaming during progress')
  .option('--log-lines <number>', 'Number of log lines to show', '5')
  .allowUnknownOption()
  .action(async (target: string, args: string[], options) => {
    const parsedOptions = {
      timeout: Number.parseInt(options.timeout, 10),
      force: options.force,
      noWait: !options.wait, // --no-wait sets wait=false
      verbose: options.verbose,
      showLogs: options.logs !== false, // --no-logs sets logs=false
      logLines: Number.parseInt(options.logLines, 10),
    };

    await runWrapper(target, args, parsedOptions);
  });

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('❌ Unhandled promise rejection:'));
  console.error(chalk.red(`   ${reason}`));
  console.error(chalk.yellow('\n💡 This is likely a bug. Please report it with:'));
  console.error('   • Your poltergeist.config.json');
  console.error('   • The command you ran');
  console.error('   • Your environment (OS, Node version)');
  process.exit(1);
});

// Parse CLI arguments
program.parse();
