import chalk from 'chalk';
import { ConfigurationError } from '../config.js';
import type { PoltergeistConfig } from '../types.js';
import { ConfigurationManager } from '../utils/config-manager.js';

export interface LoadedConfiguration {
  config: PoltergeistConfig;
  projectRoot: string;
  configPath: string;
}

/**
 * Load the Poltergeist configuration from disk and exit with a friendly
 * message when the config is invalid. This keeps command handlers slim while
 * preserving previous CLI behavior.
 */
export async function loadConfigurationOrExit(configPath?: string): Promise<LoadedConfiguration> {
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

export type GitSummaryMode = 'ai' | 'list' | undefined;

export function parseGitSummaryModeOption(value?: string): GitSummaryMode {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'ai' || normalized === 'list') {
    return normalized;
  }
  throw new Error(`Invalid git mode "${value}". Use "ai" or "list".`);
}
