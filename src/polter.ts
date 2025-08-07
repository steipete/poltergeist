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
import { existsSync, readFileSync } from 'fs';
import ora from 'ora';
import { resolve as resolvePath, dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Read package.json without experimental import syntax
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
import {
  configurePolterCommand,
  getPolterDescription,
  type ParsedPolterOptions,
  parsePolterOptions,
  setupPolterErrorHandling,
} from './cli-shared/polter-command.js';
import type { PoltergeistState } from './state.js';
import type { Target } from './types.js';
import { BuildStatusManager } from './utils/build-status-manager.js';
import { CLIFormatter, type OptionInfo } from './utils/cli-formatter.js';
import { ConfigurationManager } from './utils/config-manager.js';
import { FileSystemUtils } from './utils/filesystem.js';
import { poltergeistMessage } from './utils/ghost.js';

interface LogOptions {
  showLogs: boolean;
  logLines: number;
}

/**
 * Read the last N lines from a file
 */
function readLastLines(filePath: string, lines: number): string[] {
  try {
    if (!existsSync(filePath)) {
      return [];
    }

    const content = readFileSync(filePath, 'utf-8');
    const allLines = content.trim().split('\n');
    return allLines.slice(-lines);
  } catch (_error) {
    return [];
  }
}

/**
 * Checks if Poltergeist is currently running for this target
 */
function isPoltergeistRunning(state: PoltergeistState | null): boolean {
  if (!state || !state.process) {
    return false;
  }

  // Check if process is marked as active and heartbeat is recent (within last 10 seconds)
  if (state.process.lastHeartbeat) {
    const heartbeatAge = Date.now() - new Date(state.process.lastHeartbeat).getTime();
    // Consider running if heartbeat within 10 seconds AND process is marked active
    return state.process.isActive && heartbeatAge < 10000;
  }

  return false;
}

/**
 * Gets build status for a target by reading state file directly
 */
async function getBuildStatus(
  projectRoot: string,
  target: Target,
  options?: { checkProcessForBuilding?: boolean }
): Promise<'building' | 'failed' | 'success' | 'unknown' | 'poltergeist-not-running'> {
  try {
    const stateFilePath = FileSystemUtils.getStateFilePath(projectRoot, target.name);

    if (!existsSync(stateFilePath)) {
      return 'unknown';
    }

    const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(stateFilePath);

    if (!state) {
      return 'unknown';
    }

    // Check if Poltergeist is running
    if (!isPoltergeistRunning(state)) {
      return 'poltergeist-not-running';
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
        poltergeistMessage(
          'warning',
          `⚠ Could not read build status: ${error instanceof Error ? error.message : error}`
        )
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
  // In non-TTY environments (like tests), ora falls back to just console.log
  const spinner = ora({
    text: 'Build in progress...',
    color: 'cyan',
    spinner: 'dots',
    isEnabled: process.stdout.isTTY !== false, // Explicitly check TTY
  });

  // Start spinner (automatically handles TTY detection and cursor hiding)
  spinner.start();

  // Determine log file path using consistent naming
  const logFile = FileSystemUtils.getLogFilePath(projectRoot, target.name);

  // Update elapsed time and build logs periodically
  const timeInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;

    if (logOptions.showLogs) {
      // Read actual log file
      const logLines = readLastLines(logFile, logOptions.logLines);

      if (logLines.length > 0) {
        const logText = logLines.map((line) => `│ ${line.trim()}`).join('\n');
        spinner.text = `Build in progress... ${Math.round(elapsed / 100) / 10}s\n${logText}`;
      } else {
        spinner.text = `Build in progress... ${Math.round(elapsed / 100) / 10}s`;
      }
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
    console.error(
      chalk.red(poltergeistMessage('error', `Binary not found for target '${targetName}'`))
    );
    console.error(chalk.yellow('Tried the following locations:'));
    possiblePaths.forEach((path) => console.error(chalk.gray(`   ${path}`)));
    console.error(chalk.yellow('   Try running: poltergeist start'));
    return 1;
  }

  // Show warning banner
  console.warn(chalk.yellow(poltergeistMessage('warning', '⚠ Executing potentially stale binary')));
  console.warn(chalk.yellow('   The binary may be outdated. For fresh builds:'));
  console.warn(chalk.yellow('   npm run poltergeist:haunt'));
  console.warn('');

  if (options.verbose) {
    console.log(chalk.gray(poltergeistMessage('info', `Project root: ${projectRoot}`)));
    console.log(chalk.gray(poltergeistMessage('info', `Binary path: ${binaryPath}`)));
    console.log(
      chalk.yellow(poltergeistMessage('warning', '⚠ Status: Executing without build verification'))
    );
  }

  // Always show this message as tests depend on it
  console.log(
    chalk.green(poltergeistMessage('success', `Running binary: ${targetName} (potentially stale)`))
  );

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
      console.error(chalk.red(poltergeistMessage('error', `Failed to execute ${targetName}:`)));
      console.error(chalk.red(`   ${error.message}`));

      // Provide helpful suggestions based on error type
      if (error.message.includes('ENOENT')) {
        console.error(chalk.yellow('   Tips:'));
        console.error('   • Check if the binary exists and is executable');
        console.error('   • Try running: poltergeist start');
        console.error('   • Verify the output path in your configuration');
      } else if (error.message.includes('EACCES')) {
        console.error(chalk.yellow('   Permission denied:'));
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
function executeTarget(
  target: Target,
  projectRoot: string,
  args: string[],
  options: { verbose: boolean }
): Promise<number> {
  return new Promise((resolve) => {
    // Get output path based on target type
    let binaryPath: string;
    if ('outputPath' in target && target.outputPath) {
      binaryPath = resolvePath(projectRoot, target.outputPath);
    } else {
      console.error(
        chalk.red(
          poltergeistMessage('error', `Target '${target.name}' does not have an output path`)
        )
      );
      resolve(1);
      return;
    }

    if (!existsSync(binaryPath)) {
      console.error(chalk.red(poltergeistMessage('error', `Binary not found: ${binaryPath}`)));
      console.error(chalk.yellow(`   Try running: poltergeist start`));
      resolve(1);
      return;
    }

    if (options.verbose) {
      console.log(
        chalk.green(poltergeistMessage('success', `Running fresh binary: ${target.name}`))
      );
    }

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
      console.error(chalk.red(poltergeistMessage('error', `Failed to execute ${target.name}:`)));
      console.error(chalk.red(`   ${error.message}`));

      // Provide helpful suggestions based on error type
      if (error.message.includes('ENOENT')) {
        console.error(chalk.yellow('   Tips:'));
        console.error('   • Check if the binary exists and is executable');
        console.error('   • Try running: poltergeist start');
        console.error('   • Verify the output path in your configuration');
      } else if (error.message.includes('EACCES')) {
        console.error(chalk.yellow('   Permission denied:'));
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
 * Shows polter's help message with available targets
 */
async function showPolterHelp() {
  const options: OptionInfo[] = [
    { flags: '-t, --timeout <ms>', description: 'Build wait timeout (default: 300s)' },
    { flags: '-f, --force', description: 'Run even if build failed' },
    { flags: '-n, --no-wait', description: "Don't wait for builds" },
    { flags: '--verbose', description: 'Show detailed status info' },
    { flags: '--no-logs', description: 'Disable build log streaming' },
    { flags: '-v, --version', description: 'Show version' },
    { flags: '-h, --help', description: 'Show help' },
  ];

  // Try to load configuration and show available targets
  let targetsSection = '';
  let examples: { command: string; description?: string }[] = [];
  let footerMessage = '';

  try {
    const discovery = await ConfigurationManager.discoverAndLoadConfig();
    if (!discovery) {
      targetsSection = `  ${chalk.red('No poltergeist.config.json found in this directory')}\n\n`;
      targetsSection += '  To get started:\n';
      targetsSection += '    1. Run: poltergeist init\n';
      targetsSection += '    2. Configure executable targets\n';
      targetsSection += '    3. Run: poltergeist start\n';
      targetsSection += '    4. Use: polter <target>';
    } else {
      const { config, projectRoot } = discovery;
      const executableTargets = ConfigurationManager.getExecutableTargets(config);

      if (executableTargets.length === 0) {
        targetsSection = `  ${chalk.yellow('No executable targets configured')}\n\n`;
        targetsSection += '  Add an executable target to poltergeist.config.json:\n';
        targetsSection += chalk.gray('    {\n');
        targetsSection += chalk.gray('      "targets": [{\n');
        targetsSection += chalk.gray('        "name": "my-app",\n');
        targetsSection += chalk.gray('        "type": "executable",\n');
        targetsSection += chalk.gray('        "enabled": true,\n');
        targetsSection += chalk.gray('        "buildCommand": "npm run build",\n');
        targetsSection += chalk.gray('        "outputPath": "./dist/app.js",\n');
        targetsSection += chalk.gray('        "watchPaths": ["src/**/*.ts"]\n');
        targetsSection += chalk.gray('      }]\n');
        targetsSection += chalk.gray('    }');
      } else {
        const targetLines = [];
        for (const target of executableTargets) {
          const status = await getBuildStatus(projectRoot, target);
          let mappedStatus: 'success' | 'building' | 'failed' | 'not-running' | 'unknown';

          switch (status) {
            case 'poltergeist-not-running':
              mappedStatus = 'not-running';
              break;
            default:
              mappedStatus = status;
          }

          targetLines.push(CLIFormatter.formatTarget(target.name, mappedStatus, target.outputPath));
        }
        targetsSection = targetLines.join('\n');

        // Generate examples based on first target
        const firstTarget = executableTargets[0];
        examples = [
          { command: `${firstTarget.name}`, description: `Run ${firstTarget.name}` },
          {
            command: `${firstTarget.name} -- --help`,
            description: `Pass --help to ${firstTarget.name}`,
          },
          { command: `${firstTarget.name} --verbose`, description: 'Show detailed execution info' },
          { command: `${firstTarget.name} --force`, description: 'Run even if build failed' },
        ];

        // Check if Poltergeist is running
        const anyRunning = executableTargets.some((target) => {
          const stateFilePath = FileSystemUtils.getStateFilePath(projectRoot, target.name);
          if (!existsSync(stateFilePath)) return false;
          const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(stateFilePath);
          return isPoltergeistRunning(state);
        });

        if (!anyRunning) {
          footerMessage = `\n${chalk.yellow('⚠  Poltergeist is not running')}\n   Start watching for fresh builds: ${chalk.cyan('poltergeist start')}`;
        }
      }
    }
  } catch (error) {
    targetsSection = `  ${chalk.red('Error loading configuration:')}\n`;
    targetsSection += `  ${error instanceof Error ? error.message : error}`;
  }

  const helpText = CLIFormatter.formatHelp({
    title: 'Polter',
    tagline: 'Smart executable wrapper for Poltergeist',
    programName: 'polter',
    usage: '<target> [args...]',
    options,
    examples,
    additionalSections: [
      {
        title: 'Targets',
        content: targetsSection,
      },
    ],
  });

  console.log(helpText);
  if (footerMessage) {
    console.log(footerMessage);
  }
}

/**
 * Wrapper that handles default target selection
 */
async function runWrapperWithDefaults(
  targetName: string | undefined,
  args: string[],
  options: ParsedPolterOptions
) {
  // If help flag is set or no target specified, show help
  if (options.help || !targetName) {
    await showPolterHelp();
    process.exit(0);
  }

  await runWrapper(targetName, args, options);
}

/**
 * Main pgrun execution logic
 */
export async function runWrapper(targetName: string, args: string[], options: ParsedPolterOptions) {
  // Special handling for peekaboo - suppress all non-error output for complete transparency
  const isSilentTarget = targetName === 'peekaboo';
  const effectiveVerbose = isSilentTarget ? false : options.verbose;
  let poltergeistNotRunning = false;

  try {
    // Find poltergeist config
    const discovery = await ConfigurationManager.discoverAndLoadConfig();
    if (!discovery) {
      // No Poltergeist config found - fall back to stale execution
      if (options.verbose) {
        console.warn(
          chalk.yellow(
            '👻 [Poltergeist] ⚠ No poltergeist.config.json found - attempting stale execution'
          )
        );
      }

      // Try to find project root (current directory)
      const projectRoot = process.cwd();
      if (options.verbose) {
        console.log(
          chalk.gray(`👻 [Poltergeist] No config found, using cwd as project root: ${projectRoot}`)
        );
      }
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
          chalk.yellow(
            `👻 [Poltergeist] ⚠ Target '${targetName}' not found in config - attempting stale execution`
          )
        );
      }

      const availableTargets = ConfigurationManager.getExecutableTargets(config).map((t) => t.name);
      if (availableTargets.length > 0) {
        console.warn(chalk.yellow('👻 [Poltergeist] Available configured targets:'));
        availableTargets.forEach((name) => console.warn(chalk.yellow(`   - ${name}`)));
        console.warn('');
      }

      // When target is not in config, use current directory for stale execution
      // This allows running arbitrary binaries from the current directory
      const staleExecutionRoot = process.cwd();
      const exitCode = await executeStaleWithWarning(targetName, staleExecutionRoot, args, options);
      process.exit(exitCode);
    }

    // Validate target type
    if (target.type !== 'executable') {
      console.error(
        chalk.red(
          `👻 [Poltergeist] Target '${targetName}' is not executable (type: ${target.type})`
        )
      );
      console.error(chalk.yellow('   polter only works with executable targets'));
      console.error('   • Executable targets have "type": "executable" in the config');
      console.error('   • Other target types are handled by Poltergeist daemon');
      process.exit(1);
    }

    if (effectiveVerbose) {
      console.log(chalk.gray(`👻 [Poltergeist] Project root: ${projectRoot}`));
      console.log(chalk.gray(`👻 [Poltergeist] Target: ${target.name} (${target.outputPath})`));
    }

    // Check build status
    const status = await getBuildStatus(projectRoot, target);

    if (effectiveVerbose) {
      console.log(chalk.gray(`👻 [Poltergeist] Build status: ${status}`));
    }

    // Check if Poltergeist is not running
    if (status === 'poltergeist-not-running') {
      poltergeistNotRunning = true;
      if (!isSilentTarget) {
        console.warn(chalk.yellow('👻 [Poltergeist] ⚠ Executing potentially stale binary'));
        console.warn(chalk.yellow('   The binary may be outdated. For fresh builds:'));
        console.warn(chalk.yellow('   npm run poltergeist:haunt'));
        console.warn('');
      }
    }

    // Handle different build states
    switch (status) {
      case 'poltergeist-not-running':
        // Already handled warning above, proceed with execution
        break;
      case 'building': {
        // Build is in progress - lastBuild.status === 'building'
        if (options.noWait) {
          console.error(chalk.red('👻 [Poltergeist] Build in progress and --no-wait specified'));
          process.exit(1);
        }

        const result = await waitForBuildCompletion(projectRoot, target, options.timeout, {
          showLogs: options.showLogs,
          logLines: options.logLines,
        });

        if (result === 'timeout') {
          console.error(chalk.red(`👻 [Poltergeist] Build timeout after ${options.timeout}ms`));
          console.error(chalk.yellow('   Solutions:'));
          console.error(
            `   • Increase timeout: polter ${targetName} --timeout ${options.timeout * 2}`
          );
          console.error('   • Check build logs: poltergeist logs');
          console.error('   • Verify Poltergeist is running: poltergeist status');
          process.exit(1);
        }

        if (result === 'failed' && !options.force) {
          console.error(chalk.red('👻 [Poltergeist] Build failed'));
          console.error(chalk.yellow('   Options:'));
          console.error('   • Check build logs: poltergeist logs');
          console.error(`   • Force execution anyway: polter ${targetName} --force`);
          console.error('   • Fix build errors and try again');
          process.exit(1);
        }

        if (result === 'failed' && options.force) {
          console.warn(
            chalk.yellow('👻 [Poltergeist] ⚠ Running despite build failure (--force specified)')
          );
        }
        break;
      }

      case 'failed':
        if (!options.force) {
          console.error(chalk.red('👻 [Poltergeist] Last build failed'));
          console.error(
            chalk.yellow('   Run `poltergeist logs` for details or use --force to run anyway')
          );
          process.exit(1);
        }
        console.warn(chalk.yellow('⚠️  Running despite build failure (--force specified)'));
        break;

      case 'success':
        if (effectiveVerbose) {
          console.log(chalk.green('👻 [Poltergeist] Build successful'));
        }
        break;

      case 'unknown':
        if (!isSilentTarget && !poltergeistNotRunning) {
          console.warn(chalk.yellow('👻 [Poltergeist] ⚠ Build status unknown, proceeding...'));
        }
        break;
    }

    // Execute the target
    const exitCode = await executeTarget(target, projectRoot, args, { verbose: effectiveVerbose });
    process.exit(exitCode);
  } catch (error) {
    console.error(chalk.red('👻 [Poltergeist] Unexpected error:'));
    console.error(chalk.red(`   ${error instanceof Error ? error.message : error}`));

    if (options.verbose && error instanceof Error) {
      console.error(chalk.gray('\nStack trace:'));
      console.error(chalk.gray(error.stack));
    }

    console.error(chalk.yellow('\n   Common solutions:'));
    console.error('   • Check if poltergeist.config.json exists and is valid');
    console.error('   • Verify target name matches configuration');
    console.error('   • Run with --verbose for more details');
    console.error('   • Check poltergeist status: poltergeist status');

    process.exit(1);
  }
}

// Only run CLI setup if this file is being executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI setup
  const program = new Command();

  const polterCommand = program
    .name('polter')
    .description(getPolterDescription())
    .version(packageJson.version, '-v, --version', 'output the version number')
    .argument('[target]', 'Name of the target to run')
    .argument('[args...]', 'Arguments to pass to the target executable')
    .helpOption(false) // Disable default help to handle it ourselves
    .option('-h, --help', 'Show help for polter');

  // Configure with shared options
  configurePolterCommand(polterCommand);

  polterCommand.action(async (target: string | undefined, args: string[], options) => {
    const parsedOptions = parsePolterOptions(options);
    await runWrapperWithDefaults(target, args, parsedOptions);
  });

  // Setup shared error handling
  setupPolterErrorHandling();

  // Parse CLI arguments
  program.parse();
}
