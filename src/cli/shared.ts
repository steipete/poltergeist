import chalk from 'chalk';
import type { LoadedConfiguration } from './configuration.js';
import { loadConfiguration, parseGitSummaryModeOption } from './configuration.js';

export const exitWithError = (message: string, code = 1): never => {
  console.error(chalk.red(message));
  if (process.env.VITEST) {
    throw new Error(`EXIT:${code}:${message}`);
  }
  process.exit(code);
};

export const loadConfigOrExit = async (configPath?: string): Promise<LoadedConfiguration> => {
  try {
    return await loadConfiguration(configPath);
  } catch (error) {
    return exitWithError((error as Error).message);
  }
};

export const parseGitModeOrExit = (value?: string): 'ai' | 'list' | undefined => {
  try {
    return parseGitSummaryModeOption(value);
  } catch (error) {
    return exitWithError((error as Error).message);
  }
};
