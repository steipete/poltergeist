/**
 * Unified configuration management for Poltergeist
 * Consolidates config loading, discovery, and validation logic
 */

import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { dirname, resolve as resolvePath } from 'path';
import type { PoltergeistConfig } from '../types.js';
import { FileSystemUtils } from './filesystem.js';

export interface ConfigDiscoveryResult {
  config: PoltergeistConfig;
  configPath: string;
  projectRoot: string;
}

/**
 * Centralized configuration management for all Poltergeist operations
 */
export class ConfigurationManager {
  /**
   * Load configuration from a specific file path
   */
  public static async loadConfigFromPath(configPath: string): Promise<PoltergeistConfig> {
    try {
      const configContent = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent) as PoltergeistConfig;

      // Validate basic structure
      if (!config.targets || !Array.isArray(config.targets)) {
        throw new Error('Configuration must have a "targets" array');
      }

      return config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load config from ${configPath}: ${message}`);
    }
  }

  /**
   * Discover and load configuration by walking up the directory tree
   */
  public static async discoverAndLoadConfig(
    startDir: string = process.cwd()
  ): Promise<ConfigDiscoveryResult | null> {
    const configPath = FileSystemUtils.findFileUpTree('poltergeist.config.json', startDir);

    if (!configPath) {
      return null;
    }

    try {
      const config = await ConfigurationManager.loadConfigFromPath(configPath);
      const projectRoot = dirname(configPath);

      return {
        config,
        configPath,
        projectRoot,
      };
    } catch (error) {
      console.error(
        chalk.red(`❌ Error reading config at ${configPath}:`),
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  /**
   * Get configuration with standardized error handling
   */
  public static async getConfig(configPathOrStartDir?: string): Promise<ConfigDiscoveryResult> {
    let result: ConfigDiscoveryResult | null = null;

    if (configPathOrStartDir) {
      // If it looks like a config file path, try loading it directly
      if (configPathOrStartDir.endsWith('.json')) {
        try {
          const config = await ConfigurationManager.loadConfigFromPath(configPathOrStartDir);
          const projectRoot = dirname(resolvePath(configPathOrStartDir));

          result = {
            config,
            configPath: resolvePath(configPathOrStartDir),
            projectRoot,
          };
        } catch (error) {
          throw new Error(
            `Failed to load config: ${error instanceof Error ? error.message : error}`
          );
        }
      } else {
        // Otherwise treat it as a starting directory
        result = await ConfigurationManager.discoverAndLoadConfig(configPathOrStartDir);
      }
    } else {
      // Default: discover from current directory
      result = await ConfigurationManager.discoverAndLoadConfig();
    }

    if (!result) {
      throw new Error(
        'No poltergeist.config.json found in current directory or parents.\n' +
          '🔧 Run this command from within a Poltergeist-managed project'
      );
    }

    return result;
  }

  /**
   * Find a target by name in the configuration
   */
  public static findTarget(config: PoltergeistConfig, name: string) {
    return config.targets.find((target) => target.name === name) || null;
  }

  /**
   * Get all executable targets from configuration
   */
  public static getExecutableTargets(config: PoltergeistConfig) {
    return config.targets.filter((target) => target.type === 'executable');
  }
}
