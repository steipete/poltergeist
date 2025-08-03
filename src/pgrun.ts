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

import { Command } from 'commander';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve as resolvePath, dirname } from 'path';
import chalk from 'chalk';
import { PoltergeistConfig, Target } from './types.js';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';

interface ConfigDiscoveryResult {
  config: PoltergeistConfig;
  configPath: string;
  projectRoot: string;
}

/**
 * Discovers poltergeist config by walking up the directory tree
 */
async function findPoltergeistConfig(startDir = process.cwd()): Promise<ConfigDiscoveryResult | null> {
  let currentDir = resolvePath(startDir);
  const root = resolvePath('/');

  while (currentDir !== root) {
    const configPath = resolvePath(currentDir, 'poltergeist.config.json');
    
    if (existsSync(configPath)) {
      try {
        const configContent = await readFile(configPath, 'utf-8');
        const config = JSON.parse(configContent) as PoltergeistConfig;
        return {
          config,
          configPath,
          projectRoot: currentDir
        };
      } catch (error) {
        console.error(chalk.red(`❌ Error reading config at ${configPath}:`), error instanceof Error ? error.message : error);
        return null;
      }
    }

    currentDir = dirname(currentDir);
  }

  return null;
}

/**
 * Finds a target by name in the config
 */
function findTargetByName(config: PoltergeistConfig, name: string): Target | null {
  return config.targets.find(target => target.name === name) || null;
}

/**
 * Generate state file path for a target (matching StateManager logic)
 */
function getStateFilePath(projectRoot: string, targetName: string): string {
  const projectName = projectRoot.split('/').pop() || 'unknown';
  const projectHash = createHash('sha256').update(projectRoot).digest('hex').substring(0, 8);
  const fileName = `${projectName}-${projectHash}-${targetName}.state`;
  const stateDir = process.env.POLTERGEIST_STATE_DIR || '/tmp/poltergeist';
  return resolvePath(stateDir, fileName);
}

/**
 * Check if a process is still alive
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets build status for a target by reading state file directly
 */
async function getBuildStatus(projectRoot: string, target: Target): Promise<'building' | 'failed' | 'success' | 'unknown'> {
  try {
    const stateFilePath = getStateFilePath(projectRoot, target.name);
    
    if (!existsSync(stateFilePath)) {
      return 'unknown';
    }

    const stateContent = await readFile(stateFilePath, 'utf-8');
    const state = JSON.parse(stateContent);
    
    if (!state) {
      return 'unknown';
    }

    // Check if process is still alive (building)
    if (state.process && isProcessAlive(state.process.pid)) {
      return 'building';
    }

    // Check build status
    if (state.lastBuild?.status === 'failed') {
      return 'failed';
    }

    if (state.lastBuild?.status === 'success') {
      return 'success';
    }

    return 'unknown';
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Could not read build status: ${error instanceof Error ? error.message : error}`));
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
    
    process.stdout.write(`\r${chalk.cyan(spinner)} Build in progress... ${Math.round(elapsed / 100) / 10}s`);
  }, 100);

  try {
    while (Date.now() - startTime < timeoutMs) {
      const status = await getBuildStatus(projectRoot, target);
      
      if (status === 'success') {
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear spinner line
        return 'success';
      }
      
      if (status === 'failed') {
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear spinner line
        return 'failed';
      }
      
      if (status !== 'building') {
        // Build process died, assume completion
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear spinner line
        return await getBuildStatus(projectRoot, target) === 'success' ? 'success' : 'failed';
      }

      // Short sleep to avoid busy polling
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear spinner line
    return 'timeout';
  } catch (error) {
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear spinner line
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
    
    const child = spawn(binaryPath, args, {
      stdio: 'inherit',
      cwd: projectRoot
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
async function runWrapper(targetName: string, args: string[], options: {
  timeout: number;
  force: boolean;
  noWait: boolean;
  verbose: boolean;
}) {
  try {
    // Find poltergeist config
    const discovery = await findPoltergeistConfig();
    if (!discovery) {
      console.error(chalk.red('❌ No poltergeist.config.json found in current directory or parents'));
      console.error(chalk.yellow('🔧 Run this command from within a Poltergeist-managed project'));
      process.exit(1);
    }

    const { config, projectRoot } = discovery;

    // Find target
    const target = findTargetByName(config, targetName);
    if (!target) {
      console.error(chalk.red(`❌ Target '${targetName}' not found in config`));
      const availableTargets = config.targets
        .filter(t => t.type === 'executable')
        .map(t => t.name);
      
      if (availableTargets.length > 0) {
        console.error(chalk.yellow('Available executable targets:'));
        availableTargets.forEach(name => console.error(chalk.yellow(`  - ${name}`)));
      } else {
        console.error(chalk.yellow('No executable targets found in config'));
      }
      process.exit(1);
    }

    // Validate target type
    if (target.type !== 'executable') {
      console.error(chalk.red(`❌ Target '${targetName}' is not executable (type: ${target.type})`));
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
      case 'building':
        if (options.noWait) {
          console.error(chalk.red('❌ Build in progress and --no-wait specified'));
          process.exit(1);
        }
        
        console.log(chalk.cyan('⏳ Build in progress, waiting for completion...'));
        const result = await waitForBuildCompletion(projectRoot, target, options.timeout);
        
        if (result === 'timeout') {
          console.error(chalk.red(`❌ Build timeout after ${options.timeout}ms`));
          console.error(chalk.yellow('🔧 Try increasing timeout with --timeout or check build logs'));
          process.exit(1);
        }
        
        if (result === 'failed' && !options.force) {
          console.error(chalk.red('❌ Build failed'));
          console.error(chalk.yellow('🔧 Run `poltergeist logs` for details or use --force to run anyway'));
          process.exit(1);
        }
        break;

      case 'failed':
        if (!options.force) {
          console.error(chalk.red('❌ Last build failed'));
          console.error(chalk.yellow('🔧 Run `poltergeist logs` for details or use --force to run anyway'));
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
    console.error(chalk.red('❌ Unexpected error:'), error instanceof Error ? error.message : error);
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
  .option('-n, --no-wait', 'Don\'t wait for builds, fail if building', false)
  .option('-v, --verbose', 'Show detailed status information', false)
  .action(async (target: string, args: string[], options) => {
    const parsedOptions = {
      timeout: parseInt(options.timeout, 10),
      force: options.force,
      noWait: options.noWait,
      verbose: options.verbose
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