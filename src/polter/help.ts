import chalk from 'chalk';
import { existsSync } from 'fs';
import type { PoltergeistState } from '../state.js';
import type { Target } from '../types.js';
import { ConfigurationManager } from '../utils/config-manager.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import { getBuildStatus, isPoltergeistRunning } from './build-status.js';

export async function showPolterHelp(): Promise<void> {
  console.log(`${chalk.cyan('👻 Polter')} - Smart execution wrapper for Poltergeist\n`);
  console.log('Ensures you never run stale or failed builds by checking build status first.\n');

  console.log(chalk.bold('USAGE'));
  console.log('  $ polter <target> [args...]\n');

  console.log(chalk.bold('WHAT IT DOES'));
  console.log('  • Checks if target build is fresh and successful');
  console.log('  • Waits for in-progress builds to complete');
  console.log('  • Fails fast on build errors with clear messages');
  console.log("  • Runs the binary only when it's ready\n");

  let hasTargets = false;

  try {
    const discovery = await ConfigurationManager.discoverAndLoadConfig();
    if (discovery) {
      const { config, projectRoot } = discovery;
      const executableTargets = ConfigurationManager.getExecutableTargets(config);

      if (executableTargets.length > 0) {
        hasTargets = true;
        console.log(chalk.bold('AVAILABLE TARGETS'));

        for (const target of executableTargets) {
          const status = await getBuildStatus(projectRoot, target as Target);
          let statusIcon = '';
          let statusText = '';

          switch (status) {
            case 'success':
              statusIcon = chalk.green('✓');
              statusText = chalk.gray(' (ready)');
              break;
            case 'building':
              statusIcon = chalk.yellow('⟳');
              statusText = chalk.yellow(' (building)');
              break;
            case 'failed':
              statusIcon = chalk.red('✗');
              statusText = chalk.red(' (failed)');
              break;
            case 'poltergeist-not-running':
              statusIcon = chalk.gray('○');
              statusText = chalk.gray(' (daemon not running)');
              break;
            default:
              statusIcon = chalk.gray('?');
              statusText = '';
          }

          console.log(`  ${statusIcon} ${chalk.cyan(target.name)}${statusText}`);
        }
        console.log('');

        const anyRunning = executableTargets.some((target) => {
          const stateFilePath = FileSystemUtils.getStateFilePath(projectRoot, target.name);
          if (!existsSync(stateFilePath)) return false;
          const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(stateFilePath);
          return isPoltergeistRunning(state);
        });

        if (!anyRunning) {
          console.log(chalk.yellow('⚠  Poltergeist daemon is not running'));
          console.log(`   Start watching: ${chalk.cyan('poltergeist start')}\n`);
        }
      }
    }
  } catch (_error) {
    // Silently handle config errors
  }

  if (hasTargets) {
    console.log(chalk.bold('EXAMPLES'));
    console.log('  $ polter my-app              # Run my-app after ensuring fresh build');
    console.log('  $ polter my-cli --help       # Pass arguments to the target');
    console.log('  $ polter my-app --verbose    # Show build progress while waiting\n');
  } else {
    console.log(chalk.bold('GETTING STARTED'));
    console.log('  1. Create a poltergeist.config.json with executable targets');
    console.log('  2. Run: poltergeist start    # Start the build daemon');
    console.log('  3. Use: polter <target>      # Run your executables safely\n');
  }

  console.log(chalk.bold('OPTIONS'));
  console.log('  -t, --timeout <ms>    Build wait timeout (default: 300s)');
  console.log('  -f, --force           Run even if build failed');
  console.log("  -n, --no-wait         Don't wait for builds");
  console.log('  --verbose             Show detailed status info');
  console.log('  --no-logs             Disable build log streaming');
  console.log('  -v, --version         Show version');
  console.log('  -h, --help            Show this help\n');

  console.log(chalk.gray("For daemon control (start/stop/status), use 'poltergeist' instead."));
}
