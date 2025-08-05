import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoltergeistConfig } from '../src/types';

describe('Smart Defaults Integration', () => {
  let tempDir: string;
  let originalDir: string;

  beforeEach(() => {
    // Save original directory
    originalDir = process.cwd();
    // Create a unique temp directory for each test
    tempDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    // Return to original directory first
    if (originalDir && existsSync(originalDir)) {
      process.chdir(originalDir);
    }
    // Then clean up temp directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Config validation', () => {
    it('should accept minimal config without defaults', async () => {
      const minimalConfig: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'build',
            type: 'executable',
            buildCommand: 'npm run build',
            outputPath: './dist/index.js',
            watchPaths: ['src/**/*.{ts,js}'],
          },
        ],
        notifications: {
          successSound: 'Glass',
          failureSound: 'Basso',
        },
      };

      writeFileSync('poltergeist.config.json', JSON.stringify(minimalConfig, null, 2));

      // Verify the config loads without errors
      const { ConfigurationManager } = await import('../src/utils/config-manager');
      const result = await ConfigurationManager.getConfig('./poltergeist.config.json');

      expect(result.config).toBeDefined();
      expect(result.config.targets[0].name).toBe('build');
    });

    it('should apply defaults when not specified', async () => {
      const minimalConfig = {
        version: '1.0',
        projectType: 'swift',
        targets: [
          {
            name: 'my-app',
            type: 'executable',
            buildCommand: 'swift build',
            outputPath: '.build/debug/MyApp',
            watchPaths: ['Sources/**/*.swift'],
          },
        ],
      };

      writeFileSync('poltergeist.config.json', JSON.stringify(minimalConfig, null, 2));

      // Load config and check defaults are applied internally
      const { ConfigLoader } = await import('../src/config');
      const configPath = join(tempDir, 'poltergeist.config.json');
      const loader = new ConfigLoader(configPath);
      const config = loader.loadConfig();

      // These should have default values applied internally
      expect(config.targets[0].enabled).toBe(true); // Default
      // settlingDelay and debounceInterval are optional and system uses defaults when not specified
      expect(config.targets[0].settlingDelay).toBeUndefined(); // Not in minimal config
      expect(config.targets[0].debounceInterval).toBeUndefined(); // Not in minimal config
    });
  });

  describe('Glob pattern optimization', () => {
    it('should support brace expansion in watch paths', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'mixed',
        targets: [
          {
            name: 'lib',
            type: 'library',
            buildCommand: 'make',
            outputPath: './build/lib.a',
            libraryType: 'static',
            watchPaths: [
              'src/**/*.{c,cpp,h}',
              '{include,src}/**/*.{h,hpp}',
              '{CMakeLists.txt,Makefile}',
            ],
          },
        ],
      };

      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      const { ConfigLoader } = await import('../src/config');
      const loader = new ConfigLoader('./poltergeist.config.json');
      const loaded = loader.loadConfig();

      // Verify patterns are preserved
      expect(loaded.targets[0].watchPaths).toContain('src/**/*.{c,cpp,h}');
      expect(loaded.targets[0].watchPaths).toContain('{include,src}/**/*.{h,hpp}');
    });
  });

  describe('Real-world minimal configs', () => {
    it('should work with ultra-minimal Swift config', async () => {
      // Create Package.swift to trigger Swift detection
      writeFileSync('Package.swift', '// swift-tools-version:5.5');

      const swiftConfig = {
        version: '1.0',
        projectType: 'swift',
        targets: [
          {
            name: 'MyApp',
            type: 'executable',
            buildCommand: 'swift build',
            outputPath: '.build/debug/MyApp',
            watchPaths: ['Sources/**/*.swift'],
          },
        ],
      };

      const configPath = join(process.cwd(), 'poltergeist.config.json');
      writeFileSync(configPath, JSON.stringify(swiftConfig, null, 2));

      const { ConfigLoader } = await import('../src/config');
      const loader = new ConfigLoader(configPath);
      const config = loader.loadConfig();

      // Project type is explicitly set in minimal config
      expect(config.projectType).toBe('swift');
      // Type is explicitly set in config
      expect(config.targets[0].type).toBe('executable');
    });

    it('should work with minimal CMake config', async () => {
      const cmakeConfig = {
        version: '1.0',
        projectType: 'cmake',
        targets: [
          {
            name: 'mylib',
            type: 'cmake-library',
            targetName: 'mylib',
            libraryType: 'static',
            buildType: 'Debug',
            watchPaths: ['**/*.{c,cpp,h}', 'CMakeLists.txt'],
          },
        ],
        watchman: {
          excludeDirs: ['build'],
        },
        notifications: {
          successSound: 'Glass',
          failureSound: 'Basso',
        },
      };

      writeFileSync('poltergeist.config.json', JSON.stringify(cmakeConfig, null, 2));

      const { ConfigLoader } = await import('../src/config');
      const loader = new ConfigLoader('./poltergeist.config.json');
      const config = loader.loadConfig();

      expect(config.projectType).toBe('cmake');
      expect(config.watchman?.excludeDirs).toContain('build');
      // Zod applies defaults to watchman config even for minimal configs
      expect(config.watchman?.useDefaultExclusions).toBe(true);
      expect(config.watchman?.maxFileEvents).toBe(10000);
    });
  });

  describe('Size comparison', () => {
    it('minimal config should be significantly smaller', () => {
      const verboseConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'dev',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist/index.js',
            watchPaths: ['src/**/*.ts', 'src/**/*.js', 'package.json'],
            settlingDelay: 1000,
            debounceInterval: 3000,
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'node',
          maxFileEvents: 10000,
          recrawlThreshold: 5,
          settlingDelay: 1000,
        },
        notifications: {
          enabled: true,
          buildStart: false,
          buildSuccess: true,
          buildFailed: true,
          successSound: 'Glass',
          failureSound: 'Basso',
        },
        performance: {
          profile: 'balanced',
          autoOptimize: true,
        },
        logging: {
          level: 'info',
          file: '.poltergeist.log',
        },
      };

      const minimalConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'dev',
            type: 'executable',
            buildCommand: 'npm run build',
            outputPath: './dist/index.js',
            watchPaths: ['src/**/*.{ts,js}', 'package.json'],
          },
        ],
        notifications: {
          successSound: 'Glass',
          failureSound: 'Basso',
        },
      };

      const verboseJson = JSON.stringify(verboseConfig, null, 2);
      const minimalJson = JSON.stringify(minimalConfig, null, 2);

      const reduction = ((verboseJson.length - minimalJson.length) / verboseJson.length) * 100;

      console.log(`Verbose: ${verboseJson.length} bytes`);
      console.log(`Minimal: ${minimalJson.length} bytes`);
      console.log(`Reduction: ${reduction.toFixed(1)}%`);

      expect(reduction).toBeGreaterThan(50);
    });
  });
});
