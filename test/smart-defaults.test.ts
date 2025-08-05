import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { PoltergeistConfig } from '../src/types';

describe('Smart Defaults Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(__dirname);
    if (existsSync(tempDir)) {
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
      const { loadPoltergeistConfig } = await import('../src/config');
      const config = await loadPoltergeistConfig('./poltergeist.config.json');

      // These should have default values applied internally
      expect(config.targets[0].enabled).toBe(true); // Default
      expect(config.targets[0].settlingDelay).toBe(1000); // Default
      expect(config.targets[0].debounceInterval).toBe(3000); // Default
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
            watchPaths: [
              'src/**/*.{c,cpp,h}',
              '{include,src}/**/*.{h,hpp}',
              '{CMakeLists.txt,Makefile}',
            ],
          },
        ],
      };

      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      const { loadPoltergeistConfig } = await import('../src/config');
      const loaded = await loadPoltergeistConfig('./poltergeist.config.json');

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
        targets: [
          {
            name: 'MyApp',
            buildCommand: 'swift build',
            watchPaths: ['Sources/**/*.swift'],
          },
        ],
      };

      writeFileSync('poltergeist.config.json', JSON.stringify(swiftConfig, null, 2));

      const { loadPoltergeistConfig } = await import('../src/config');
      const config = await loadPoltergeistConfig('./poltergeist.config.json');

      // Should auto-detect Swift project type
      expect(config.projectType).toBe('swift');
      // Should infer executable type
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

      const { loadPoltergeistConfig } = await import('../src/config');
      const config = await loadPoltergeistConfig('./poltergeist.config.json');

      expect(config.projectType).toBe('cmake');
      expect(config.watchman?.excludeDirs).toContain('build');
      // Should not have default watchman settings
      expect(Object.keys(config.watchman || {})).toHaveLength(1);
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