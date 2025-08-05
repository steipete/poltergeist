import chalk from 'chalk';
import type { PoltergeistConfig } from '../types.js';

/**
 * Validate that a target exists in the configuration
 * @param targetName - The name of the target to validate
 * @param config - The Poltergeist configuration
 * @throws {Error} If the target does not exist
 */
export function validateTarget(targetName: string, config: PoltergeistConfig): void {
  const targetNames = config.targets.map((t) => t.name);
  if (!targetNames.includes(targetName)) {
    console.error(chalk.red(`Unknown target: ${targetName}`));
    console.error(chalk.yellow('Available targets:'));
    console.error(
      config.targets
        .map(
          (t) =>
            `  - ${chalk.cyan(t.name)} (${t.type})${t.enabled ? '' : chalk.gray(' [disabled]')}`
        )
        .join('\n')
    );
    process.exit(1);
  }
}