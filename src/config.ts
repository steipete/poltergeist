// Configuration parser for the new generic target system
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { type PoltergeistConfig, PoltergeistConfigSchema } from './types.js';
// import { Logger } from './logger.js';

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class ConfigLoader {
  private configPath: string;
  private projectRoot: string;
  // private logger?: Logger;

  constructor(configPath: string) {
    this.configPath = resolve(configPath);
    this.projectRoot = dirname(this.configPath);
    // this.logger = logger;
  }

  public loadConfig(): PoltergeistConfig {
    if (!existsSync(this.configPath)) {
      throw new ConfigurationError(`Configuration file not found: ${this.configPath}`);
    }

    const rawConfig = this.readConfigFile();
    this.checkForOldFormat(rawConfig);
    const validatedConfig = this.validateConfig(rawConfig);
    this.validateTargetNames(validatedConfig);

    return this.resolveConfigPaths(validatedConfig);
  }

  private readConfigFile(): unknown {
    try {
      const content = readFileSync(this.configPath, 'utf-8');
      // Support both JSON and JSONC (with comments)
      const jsonWithoutComments = this.stripJSONComments(content);
      return JSON.parse(jsonWithoutComments);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ConfigurationError(`Invalid JSON in configuration file: ${error.message}`);
      }
      throw error;
    }
  }

  private stripJSONComments(content: string): string {
    let result = '';
    let inString = false;
    let inSingleLineComment = false;
    let inMultiLineComment = false;
    let escaped = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];

      if (inSingleLineComment) {
        if (char === '\n') {
          inSingleLineComment = false;
          result += char;
        }
        continue;
      }

      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          inMultiLineComment = false;
          i++; // Skip the '/'
        }
        continue;
      }

      if (inString) {
        result += char;
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        result += char;
      } else if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        i++; // Skip the second '/'
      } else if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        i++; // Skip the '*'
      } else {
        result += char;
      }
    }

    return result;
  }

  private checkForOldFormat(config: unknown): void {
    const configObj = config as Record<string, unknown>;
    if ('cli' in configObj || 'macApp' in configObj) {
      throw new ConfigurationError(
        '❌ Old configuration format detected!\n\n' +
          'Poltergeist now uses a "targets" array instead of "cli" and "macApp" sections.\n\n' +
          'Please update your poltergeist.config.json to the new format:\n\n' +
          '{\n' +
          '  "targets": [\n' +
          '    {\n' +
          '      "name": "my-cli",\n' +
          '      "type": "executable",\n' +
          '      "buildCommand": "./build.sh",\n' +
          '      "outputPath": "./bin/myapp",\n' +
          '      "watchPaths": ["src/**/*.ts"]\n' +
          '    },\n' +
          '    {\n' +
          '      "name": "my-app",\n' +
          '      "type": "app-bundle",\n' +
          '      "platform": "macos",\n' +
          '      "buildCommand": "./build-app.sh",\n' +
          '      "bundleId": "com.example.myapp",\n' +
          '      "watchPaths": ["app/**/*.swift"]\n' +
          '    }\n' +
          '  ]\n' +
          '}\n\n' +
          'See: https://github.com/steipete/poltergeist#migration'
      );
    }
  }

  private validateConfig(config: unknown): PoltergeistConfig {
    try {
      return PoltergeistConfigSchema.parse(config);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        const zodError = error as unknown as { errors: Array<{ path: string[]; message: string }> };
        const issues = zodError.errors
          .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
          .join('\n');
        throw new ConfigurationError(`Configuration validation failed:\n${issues}`);
      }
      throw error;
    }
  }

  private validateTargetNames(config: PoltergeistConfig): void {
    const names = config.targets.map((t) => t.name);
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

    if (duplicates.length > 0) {
      throw new ConfigurationError(
        `Duplicate target names found: ${duplicates.join(', ')}\n` +
          'Each target must have a unique name.'
      );
    }

    // Validate target names don't contain invalid characters
    const invalidNames = names.filter((name) => !/^[a-zA-Z0-9-_]+$/.test(name));
    if (invalidNames.length > 0) {
      throw new ConfigurationError(
        `Invalid target names: ${invalidNames.join(', ')}\n` +
          'Target names must contain only letters, numbers, hyphens, and underscores.'
      );
    }
  }

  private resolveConfigPaths(config: PoltergeistConfig): PoltergeistConfig {
    // Resolve all relative paths to absolute paths based on project root
    const resolvedTargets = config.targets.map((target) => {
      const resolvedTarget = { ...target };

      // Resolve build command if it's a relative path
      if (
        resolvedTarget.buildCommand &&
        (resolvedTarget.buildCommand.startsWith('./') ||
         resolvedTarget.buildCommand.startsWith('../'))
      ) {
        resolvedTarget.buildCommand = resolve(this.projectRoot, resolvedTarget.buildCommand);
      }

      // Keep output path relative for executable and library targets
      // The builders will resolve it relative to project root as needed

      // Resolve docker context
      if (target.type === 'docker' && 'context' in resolvedTarget && resolvedTarget.context) {
        resolvedTarget.context = resolve(this.projectRoot, resolvedTarget.context);
      }

      return resolvedTarget;
    });

    // Resolve logging file path
    if (config.logging?.file && !config.logging.file.startsWith('/')) {
      config.logging.file = resolve(this.projectRoot, config.logging.file);
    }

    return {
      ...config,
      targets: resolvedTargets,
    };
  }

  public getProjectRoot(): string {
    return this.projectRoot;
  }
}

// Helper function to migrate old config to new format (for documentation)
interface OldConfig {
  cli?: {
    enabled?: boolean;
    buildCommand: string;
    outputPath: string;
    watchPaths: string[];
    statusFile?: string;
    lockFile?: string;
  };
  macApp?: {
    enabled?: boolean;
    buildCommand: string;
    bundleId: string;
    autoRelaunch?: boolean;
    watchPaths: string[];
    statusFile?: string;
    lockFile?: string;
  };
  notifications?: PoltergeistConfig['notifications'];
  logging?: PoltergeistConfig['logging'];
  settlingDelay?: number;
}

export function migrateOldConfig(oldConfig: OldConfig): PoltergeistConfig {
  const targets: PoltergeistConfig['targets'] = [];

  if (oldConfig.cli) {
    targets.push({
      name: 'cli',
      type: 'executable',
      enabled: oldConfig.cli.enabled ?? true,
      buildCommand: oldConfig.cli.buildCommand,
      outputPath: oldConfig.cli.outputPath,
      watchPaths: oldConfig.cli.watchPaths,
    });
  }

  if (oldConfig.macApp) {
    targets.push({
      name: 'mac-app',
      type: 'app-bundle',
      platform: 'macos',
      enabled: oldConfig.macApp.enabled ?? true,
      buildCommand: oldConfig.macApp.buildCommand,
      bundleId: oldConfig.macApp.bundleId,
      autoRelaunch: oldConfig.macApp.autoRelaunch,
      watchPaths: oldConfig.macApp.watchPaths,
    });
  }

  return {
    version: '1.0',
    projectType: 'swift', // Default for legacy configs
    targets,
    notifications: oldConfig.notifications,
    logging: oldConfig.logging,
    watchman: {
      useDefaultExclusions: true,
      excludeDirs: [],
      projectType: 'swift', // Default for legacy configs
      maxFileEvents: 10000,
      recrawlThreshold: 5,
      settlingDelay: oldConfig.settlingDelay || 1000,
    },
  };
}
