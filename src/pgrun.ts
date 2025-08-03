#!/usr/bin/env node

/**
 * pgrun - Smart wrapper for running executables managed by Poltergeist
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
import { resolve as resolvePath } from 'path';
import type { PoltergeistState } from './state.js';
import type { Target } from './types.js';
import { BuildStatusManager } from './utils/build-status-manager.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { FileSystemUtils } from './utils/filesystem.js';

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
  timeoutMs = 30000
): Promise<'success' | 'failed' | 'timeout'> {
  const startTime = Date.now();
  let spinnerIndex = 0;
  const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  // Clear any existing interval
  const interval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const spinner = spinnerChars[spinnerIndex % spinnerChars.length];
    spinnerIndex++;

    process.stdout.write(
      `\r${chalk.cyan(spinner)} Build in progress... ${Math.round(elapsed / 100) / 10}s`
    );
  }, 100);

  try {
    while (Date.now() - startTime < timeoutMs) {
      const status = await getBuildStatus(projectRoot, target, { checkProcessForBuilding: true });

      if (status === 'success') {
        clearInterval(interval);
        process.stdout.write(`\r${' '.repeat(50)}\r`); // Clear spinner line
        return 'success';
      }

      if (status === 'failed') {
        clearInterval(interval);
        process.stdout.write(`\r${' '.repeat(50)}\r`); // Clear spinner line
        return 'failed';
      }

      if (status !== 'building') {
        // Build process died or status changed - check the actual final status
        clearInterval(interval);
        process.stdout.write(`\r${' '.repeat(50)}\r`); // Clear spinner line
        
        const finalStatus = await getBuildStatus(projectRoot, target, { checkProcessForBuilding: true });
        if (finalStatus === 'success') {
          return 'success';
        } else if (finalStatus === 'failed') {
          return 'failed';
        } else {
          // If status is unknown (e.g., file deleted), assume build process died and proceed
          return 'success';
        }
      }

      // Short sleep to avoid busy polling
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    clearInterval(interval);
    process.stdout.write(`\r${' '.repeat(50)}\r`); // Clear spinner line
    return 'timeout';
  } catch (error) {
    clearInterval(interval);
    process.stdout.write(`\r${' '.repeat(50)}\r`); // Clear spinner line
    throw error;
  }
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
      console.error(chalk.red(`❌ Failed to execute ${target.name}:`), error.message);
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
  }
) {
  try {
    // Find poltergeist config
    const discovery = await ConfigurationManager.discoverAndLoadConfig();
    if (!discovery) {
      console.error(
        chalk.red('❌ No poltergeist.config.json found in current directory or parents')
      );
      console.error(chalk.yellow('🔧 Run this command from within a Poltergeist-managed project'));
      process.exit(1);
    }

    const { config, projectRoot } = discovery;

    // Find target
    const target = ConfigurationManager.findTarget(config, targetName);
    if (!target) {
      console.error(chalk.red(`❌ Target '${targetName}' not found in config`));
      const availableTargets = ConfigurationManager.getExecutableTargets(config).map((t) => t.name);

      if (availableTargets.length > 0) {
        console.error(chalk.yellow('Available executable targets:'));
        availableTargets.forEach((name) => console.error(chalk.yellow(`  - ${name}`)));
      } else {
        console.error(chalk.yellow('No executable targets found in config'));
      }
      process.exit(1);
    }

    // Validate target type
    if (target.type !== 'executable') {
      console.error(
        chalk.red(`❌ Target '${targetName}' is not executable (type: ${target.type})`)
      );
      console.error(chalk.yellow('🔧 pgrun only works with executable targets'));
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

        console.log(chalk.cyan('⏳ Build in progress, waiting for completion...'));
        const result = await waitForBuildCompletion(projectRoot, target, options.timeout);

        if (result === 'timeout') {
          console.error(chalk.red(`❌ Build timeout after ${options.timeout}ms`));
          console.error(
            chalk.yellow('🔧 Try increasing timeout with --timeout or check build logs')
          );
          process.exit(1);
        }

        if (result === 'failed' && !options.force) {
          console.error(chalk.red('❌ Build failed'));
          console.error(
            chalk.yellow('🔧 Run `poltergeist logs` for details or use --force to run anyway')
          );
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
    console.error(
      chalk.red('❌ Unexpected error:'),
      error instanceof Error ? error.message : error
    );
    if (options.verbose && error instanceof Error) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

// CLI setup
const program = new Command();

program
  .name('pgrun')
  .description('Smart wrapper for running executables managed by Poltergeist')
  .version('1.0.0')
  .argument('<target>', 'Name of the target to run')
  .argument('[args...]', 'Arguments to pass to the target executable')
  .option('-t, --timeout <ms>', 'Build wait timeout in milliseconds', '30000')
  .option('-f, --force', 'Run even if build failed', false)
  .option('-n, --no-wait', "Don't wait for builds, fail if building")
  .option('-v, --verbose', 'Show detailed status information', false)
  .allowUnknownOption()
  .action(async (target: string, args: string[], options) => {
    const parsedOptions = {
      timeout: Number.parseInt(options.timeout, 10),
      force: options.force,
      noWait: !options.wait, // --no-wait sets wait=false
      verbose: options.verbose,
    };

    await runWrapper(target, args, parsedOptions);
  });

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('❌ Unhandled promise rejection:'), reason);
  process.exit(1);
});

// Parse CLI arguments
program.parse();
