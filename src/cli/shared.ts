import chalk from 'chalk';
import type { PoltergeistConfig } from '../types.js';
import type { LoadedConfiguration } from './configuration.js';
import { loadConfiguration, parseGitSummaryModeOption } from './configuration.js';

export const exitWithError = (message: string, code = 1): never => {
  console.error(chalk.red(message));
  if (process.env.VITEST) {
    if ((process.exit as any)?.mock) {
      try {
        process.exit(code);
      } catch {
        // swallow mock exit exceptions so we can throw a deterministic error below
      }
    }
    throw new Error(`EXIT:${code}:${message}`);
  }
  process.exit(code);
};

export const loadConfigOrExit = async (
  configPath?: string,
  options?: { allowMissing?: boolean }
): Promise<LoadedConfiguration> => {
  try {
    return await loadConfiguration(configPath);
  } catch (error) {
    if (options?.allowMissing) {
      const projectRoot = process.cwd();
      const minimalConfig: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'node',
          maxFileEvents: 0,
          recrawlThreshold: 0,
          settlingDelay: 1000,
        },
      };
      return { config: minimalConfig, projectRoot, configPath: configPath ?? '' };
    }
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

/**
 * Convenience guard that exits with an error if the condition is falsy.
 * Keeps command handlers concise while preserving existing exit behaviour.
 */
export const ensureOrExit = (condition: any, message: string, code = 1): void => {
  if (!condition) {
    exitWithError(message, code);
  }
};
