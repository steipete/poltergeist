/**
 * Unified configuration management for Poltergeist
 * Consolidates config loading, discovery, and validation logic
 */

import chalk from 'chalk';
import { readFile } from 'fs/promises';
import { dirname, resolve as resolvePath } from 'path';
import type { ZodError, ZodIssue } from 'zod';
import type { PoltergeistConfig } from '../types.js';
import { PoltergeistConfigSchema } from '../types.js';
import { FileSystemUtils } from './filesystem.js';

export interface ConfigDiscoveryResult {
  config: PoltergeistConfig;
  configPath: string;
  projectRoot: string;
}

/**
 * Custom error class for configuration validation failures
 * Provides detailed, user-friendly error messages with specific field information
 */
export class ConfigValidationError extends Error {
  public readonly validationErrors: string[];

  constructor(message: string, zodError: ZodError) {
    const detailedErrors = ConfigValidationError.formatZodErrors(zodError);
    const fullMessage = `${message}\n\n${detailedErrors.join('\n')}`;

    super(fullMessage);
    this.name = 'ConfigValidationError';
    this.validationErrors = detailedErrors;
  }

  public static formatZodErrors(zodError: ZodError): string[] {
    return zodError.issues.map((error: ZodIssue) => {
      const path = error.path.length > 0 ? error.path.join('.') : 'root';
      return `❌ ${path}: ${error.message}`;
    });
  }
}

/**
 * Centralized configuration management for all Poltergeist operations
 *
 * Note: Uses static-only class for namespacing and API organization.
 * This provides clear boundaries for configuration-related functionality.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional design for API organization
export class ConfigurationManager {
  public static normalizeTargetName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[\s_.]+/g, '-')
      .replace(/-+/g, '-');
  }

  /**
   * Load configuration from a specific file path
   */
  public static async loadConfigFromPath(configPath: string): Promise<PoltergeistConfig> {
    try {
      const configContent = await readFile(configPath, 'utf-8');
      const rawConfig = JSON.parse(configContent);

      // Validate configuration using Zod schema
      const validationResult = PoltergeistConfigSchema.safeParse(rawConfig);

      if (!validationResult.success) {
        throw new ConfigValidationError(
          `Configuration validation failed in ${configPath}`,
          validationResult.error
        );
      }

      return validationResult.data;
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error;
      }

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
      if (error instanceof ConfigValidationError) {
        console.error(chalk.red(`❌ Configuration Error in ${configPath}:`));
        console.error(error.message);
        console.error(chalk.yellow('\n💡 Tips:'));
        console.error('   • Check the configuration format against the documentation');
        console.error('   • Ensure all required fields are present');
        console.error('   • Validate JSON syntax with a JSON formatter');
      } else {
        console.error(
          chalk.red(`❌ Error reading config at ${configPath}:`),
          error instanceof Error ? error.message : error
        );
      }
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
    const direct = config.targets.find((target) => target.name === name);
    if (direct) {
      return direct;
    }

    const normalized = ConfigurationManager.normalizeTargetName(name);
    return (
      config.targets.find(
        (target) => ConfigurationManager.normalizeTargetName(target.name) === normalized
      ) || null
    );
  }

  /**
   * Get all executable targets from configuration
   */
  public static getExecutableTargets(config: PoltergeistConfig) {
    return config.targets.filter((target) => target.type === 'executable');
  }

  /**
   * Validate a configuration object without loading from file
   * Useful for programmatic validation
   */
  public static validateConfig(config: unknown): PoltergeistConfig {
    const validationResult = PoltergeistConfigSchema.safeParse(config);

    if (!validationResult.success) {
      throw new ConfigValidationError('Configuration validation failed', validationResult.error);
    }

    return validationResult.data;
  }

  /**
   * Validate configuration and provide detailed suggestions
   */
  public static validateConfigWithSuggestions(config: unknown): {
    isValid: boolean;
    config?: PoltergeistConfig;
    errors?: string[];
    suggestions?: string[];
  } {
    const validationResult = PoltergeistConfigSchema.safeParse(config);

    if (validationResult.success) {
      return {
        isValid: true,
        config: validationResult.data,
      };
    }

    const validationError = new ConfigValidationError(
      'Configuration validation failed',
      validationResult.error
    );

    const suggestions = ConfigurationManager.generateSuggestions(validationResult.error);

    return {
      isValid: false,
      errors: validationError.validationErrors,
      suggestions,
    };
  }

  /**
   * Generate helpful suggestions based on validation errors
   */
  public static generateSuggestions(zodError: ZodError): string[] {
    const suggestions: string[] = [];

    for (const error of zodError.issues) {
      const path = error.path.join('.');
      const message = error.message.toLowerCase();

      // Generate suggestions based on path and message content
      if (path === 'version') {
        suggestions.push('💡 Set "version": "1.0" in your configuration file');
      } else if (path === 'projectType') {
        suggestions.push('💡 Use one of these project types: swift, node, rust, python, mixed');
      } else if (path.includes('type') && message.includes('enum')) {
        suggestions.push(
          '💡 Valid target types: executable, app-bundle, library, framework, test, docker, custom'
        );
      } else if (path === 'targets' && message.includes('array')) {
        suggestions.push('💡 The "targets" field should be an array: "targets": [...]');
      } else if (path.includes('buildCommand') && message.includes('string')) {
        suggestions.push(
          '💡 Build commands should be strings, e.g., "buildCommand": "swift build"'
        );
      } else if (path.includes('watchPaths') && message.includes('array')) {
        suggestions.push('💡 Watch paths should be an array: "watchPaths": ["src/**/*.swift"]');
      } else if (path.includes('name') && message.includes('empty')) {
        suggestions.push('💡 Target names cannot be empty');
      }
    }

    // Add general suggestions if no specific ones were found
    if (suggestions.length === 0) {
      suggestions.push('💡 Check the Poltergeist documentation for configuration examples');
      suggestions.push('💡 Ensure all required fields are present and properly formatted');
    }

    return suggestions;
  }
}
