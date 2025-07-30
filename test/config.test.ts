// Comprehensive tests for configuration loading and validation

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigLoader, ConfigurationError, migrateOldConfig } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('ConfigLoader', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create a temporary directory for test configs
    tempDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, '.poltergeist.json');
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (_e) {
      // Ignore cleanup errors
    }
  });

  describe('Configuration Format', () => {
    it('should load valid new format configuration', () => {
      const config = {
        targets: [
          {
            name: 'cli',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist/cli',
            watchPaths: ['src/**/*.ts'],
          },
          {
            name: 'app',
            type: 'app-bundle',
            platform: 'macos',
            enabled: true,
            buildCommand: 'xcodebuild',
            bundleId: 'com.example.app',
            watchPaths: ['app/**/*.swift'],
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);
      const loaded = loader.loadConfig();

      expect(loaded.targets).toHaveLength(2);
      expect(loaded.targets[0].name).toBe('cli');
      expect(loaded.targets[1].name).toBe('app');
    });

    it('should reject old configuration format', () => {
      const oldConfig = {
        cli: {
          enabled: true,
          buildCommand: 'npm run build',
          watchPaths: ['src/**/*.ts'],
        },
        macApp: {
          enabled: true,
          buildCommand: 'xcodebuild',
          watchPaths: ['app/**/*.swift'],
        },
      };

      writeFileSync(configPath, JSON.stringify(oldConfig, null, 2));
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow(ConfigurationError);
      expect(() => loader.loadConfig()).toThrow('Old configuration format detected');
    });

    it('should auto-migrate old format if forced', () => {
      const oldConfig = {
        cli: {
          enabled: true,
          buildCommand: 'npm run build',
          outputPath: './dist/cli',
          watchPaths: ['src/**/*.ts'],
          statusFile: '/tmp/cli-status.json',
          lockFile: '/tmp/cli.lock',
        },
        macApp: {
          enabled: false,
          buildCommand: 'xcodebuild',
          bundleId: 'com.example.app',
          watchPaths: ['app/**/*.swift'],
        },
        notifications: {
          enabled: true,
          successSound: 'Glass',
        },
        logging: {
          file: '.poltergeist.log',
          level: 'info',
        },
      };

      writeFileSync(configPath, JSON.stringify(oldConfig, null, 2));
      const loader = new ConfigLoader(configPath);

      // This should throw by default
      expect(() => loader.loadConfig()).toThrow();

      // But we can get the migrated version using the helper function
      const migrated = migrateOldConfig(oldConfig);
      expect(migrated.targets).toHaveLength(2);
      expect(migrated.targets[0].name).toBe('cli');
      expect(migrated.targets[0].type).toBe('executable');
      expect(migrated.targets[1].name).toBe('mac-app');
      expect(migrated.targets[1].type).toBe('app-bundle');
      expect(migrated.notifications).toEqual(oldConfig.notifications);
      expect(migrated.logging).toEqual(oldConfig.logging);
    });
  });

  describe('Target Validation', () => {
    it('should reject duplicate target names', () => {
      const config = {
        targets: [
          {
            name: 'my-target',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo test1',
            outputPath: './out1',
            watchPaths: ['src/**/*'],
          },
          {
            name: 'my-target', // Duplicate
            type: 'executable',
            enabled: true,
            buildCommand: 'echo test2',
            outputPath: './out2',
            watchPaths: ['lib/**/*'],
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow('Duplicate target names found: my-target');
    });

    it('should validate required fields for executable target', () => {
      const config = {
        targets: [
          {
            name: 'cli',
            type: 'executable',
            enabled: true,
            // Missing buildCommand
            watchPaths: ['src/**/*'],
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow();
    });

    it('should validate required fields for app-bundle target', () => {
      const config = {
        targets: [
          {
            name: 'app',
            type: 'app-bundle',
            platform: 'macos',
            enabled: true,
            buildCommand: 'xcodebuild',
            // Missing bundleId
            watchPaths: ['app/**/*'],
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow();
    });

    it('should validate platform values for app-bundle', () => {
      const config = {
        targets: [
          {
            name: 'app',
            type: 'app-bundle',
            platform: 'windows', // Invalid platform
            enabled: true,
            buildCommand: 'build.bat',
            bundleId: 'com.example.app',
            watchPaths: ['app/**/*'],
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow();
    });

    it('should allow valid platforms for app-bundle', () => {
      const platforms = ['macos', 'ios', 'tvos', 'watchos', 'visionos'];

      for (const platform of platforms) {
        const config = {
          targets: [
            {
              name: `app-${platform}`,
              type: 'app-bundle',
              platform,
              enabled: true,
              buildCommand: 'xcodebuild',
              bundleId: 'com.example.app',
              watchPaths: ['app/**/*'],
            },
          ],
        };

        writeFileSync(configPath, JSON.stringify(config, null, 2));
        const loader = new ConfigLoader(configPath);

        expect(() => loader.loadConfig()).not.toThrow();
      }
    });
  });

  describe('Default Values', () => {
    it('should not have settling delay if not specified', () => {
      const config = {
        targets: [
          {
            name: 'cli',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist/cli',
            watchPaths: ['src/**/*'],
            // No settlingDelay specified
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);
      const loaded = loader.loadConfig();

      expect(loaded.targets[0].settlingDelay).toBeUndefined();
    });

    it('should use custom settling delay when provided', () => {
      const config = {
        targets: [
          {
            name: 'cli',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist/cli',
            watchPaths: ['src/**/*'],
            settlingDelay: 1000,
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);
      const loaded = loader.loadConfig();

      expect(loaded.targets[0].settlingDelay).toBe(1000);
    });

    it('should not have autoRelaunch if not specified for app-bundle', () => {
      const config = {
        targets: [
          {
            name: 'app',
            type: 'app-bundle',
            platform: 'macos',
            enabled: true,
            buildCommand: 'xcodebuild',
            bundleId: 'com.example.app',
            watchPaths: ['app/**/*'],
            // No autoRelaunch specified
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);
      const loaded = loader.loadConfig();

      expect(loaded.targets[0].autoRelaunch).toBeUndefined();
    });
  });

  describe('Optional Features', () => {
    it('should load notifications config', () => {
      const config = {
        targets: [
          {
            name: 'cli',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist/cli',
            watchPaths: ['src/**/*'],
          },
        ],
        notifications: {
          enabled: true,
          onlyOnFailure: true,
          successSound: 'Glass',
          failureSound: 'Basso',
        },
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);
      const loaded = loader.loadConfig();

      expect(loaded.notifications).toEqual({
        enabled: true,
        successSound: 'Glass',
        failureSound: 'Basso',
      });
    });

    it('should load logging config', () => {
      const config = {
        targets: [
          {
            name: 'cli',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist/cli',
            watchPaths: ['src/**/*'],
          },
        ],
        logging: {
          file: '.poltergeist.log',
          level: 'debug',
          maxSize: '10m',
          maxFiles: 5,
        },
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);
      const loaded = loader.loadConfig();

      expect(loaded.logging).toBeDefined();
      expect(loaded.logging?.level).toBe('debug');
      // File path is resolved to absolute path, so just check it ends with the filename
      expect(loaded.logging?.file).toMatch(/\.poltergeist\.log$/);
    });
  });

  describe('File Handling', () => {
    it('should throw error if config file does not exist', () => {
      const loader = new ConfigLoader('/non/existent/path/.poltergeist.json');

      expect(() => loader.loadConfig()).toThrow('Configuration file not found');
    });

    it('should throw error for invalid JSON', () => {
      writeFileSync(configPath, '{ invalid json');
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow();
    });

    it('should throw error for non-object config', () => {
      writeFileSync(configPath, '"just a string"');
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow();
    });

    it('should throw error for config without targets', () => {
      writeFileSync(configPath, '{}');
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty targets array', () => {
      const config = {
        targets: [],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);
      const loaded = loader.loadConfig();

      expect(loaded.targets).toHaveLength(0);
    });

    it('should handle very long target names', () => {
      const longName = 'a'.repeat(100);
      const config = {
        targets: [
          {
            name: longName,
            type: 'executable',
            enabled: true,
            buildCommand: 'echo test',
            outputPath: './dist/test',
            watchPaths: ['src/**/*'],
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);
      const loaded = loader.loadConfig();

      expect(loaded.targets[0].name).toBe(longName);
    });

    it('should reject target names with special characters', () => {
      const config = {
        targets: [
          {
            name: 'my-target_v2.0',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo test',
            outputPath: './dist/test',
            watchPaths: ['src/**/*'],
          },
        ],
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const loader = new ConfigLoader(configPath);

      expect(() => loader.loadConfig()).toThrow('Invalid target names');
    });
  });
});
