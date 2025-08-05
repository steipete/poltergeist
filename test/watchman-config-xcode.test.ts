import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WatchmanConfigManager } from '../src/watchman-config.js';
import { createLogger } from '../src/logger.js';
import type { ProjectType } from '../src/types.js';

describe('WatchmanConfigManager - Xcode Project Detection', () => {
  let tempDir: string;
  let manager: WatchmanConfigManager;
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'poltergeist-xcode-test-'));
    process.chdir(tempDir);
    logger = createLogger();
    manager = new WatchmanConfigManager(tempDir, logger);
  });

  afterEach(() => {
    process.chdir(__dirname);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectProjectType', () => {
    it('should detect .xcodeproj as swift project', async () => {
      mkdirSync('MyApp.xcodeproj');
      writeFileSync('MyApp.xcodeproj/project.pbxproj', 'mock pbxproj');

      const projectType = await manager.detectProjectType();
      expect(projectType).toBe('swift');
    });

    it('should detect .xcworkspace as swift project', async () => {
      mkdirSync('MyApp.xcworkspace');
      writeFileSync('MyApp.xcworkspace/contents.xcworkspacedata', 'mock workspace');

      const projectType = await manager.detectProjectType();
      expect(projectType).toBe('swift');
    });

    it('should prioritize Xcode projects over Package.swift', async () => {
      // Create both Xcode project and Package.swift
      mkdirSync('MyApp.xcodeproj');
      writeFileSync('MyApp.xcodeproj/project.pbxproj', 'mock pbxproj');
      writeFileSync('Package.swift', 'import PackageDescription');

      const projectType = await manager.detectProjectType();
      expect(projectType).toBe('swift');
    });

    it('should detect swift with only Package.swift', async () => {
      writeFileSync('Package.swift', 'import PackageDescription');

      const projectType = await manager.detectProjectType();
      expect(projectType).toBe('swift');
    });

    it('should detect mixed project with multiple types', async () => {
      // Create indicators for multiple project types
      mkdirSync('MyApp.xcodeproj');
      writeFileSync('MyApp.xcodeproj/project.pbxproj', 'mock pbxproj');
      writeFileSync('package.json', '{"name": "test"}');
      writeFileSync('Cargo.toml', '[package]\nname = "test"');

      const projectType = await manager.detectProjectType();
      expect(projectType).toBe('mixed');
    });

    it('should handle iOS project structures', async () => {
      mkdirSync('ios/MyApp.xcodeproj', { recursive: true });
      writeFileSync('ios/MyApp.xcodeproj/project.pbxproj', 'mock pbxproj');

      const projectType = await manager.detectProjectType();
      expect(projectType).toBe('swift');
    });

    it('should handle macOS project structures', async () => {
      mkdirSync('mac/MyApp.xcodeproj', { recursive: true });
      writeFileSync('mac/MyApp.xcodeproj/project.pbxproj', 'mock pbxproj');

      const projectType = await manager.detectProjectType();
      expect(projectType).toBe('swift');
    });

    it('should detect workspace with nested projects', async () => {
      mkdirSync('MyApp.xcworkspace');
      writeFileSync('MyApp.xcworkspace/contents.xcworkspacedata', 'mock workspace');
      mkdirSync('MyApp.xcodeproj');
      writeFileSync('MyApp.xcodeproj/project.pbxproj', 'mock pbxproj');

      const projectType = await manager.detectProjectType();
      expect(projectType).toBe('swift');
    });
  });

  describe('Swift project exclusions', () => {
    it('should generate correct exclusions for swift projects', () => {
      const exclusions = manager.getOptimizedExclusions('swift', 'balanced', []);
      
      // Check for Swift-specific exclusions
      expect(exclusions).toContain('.build');
      expect(exclusions).toContain('DerivedData');
      expect(exclusions).toContain('*.xcworkspace/xcuserdata');
      expect(exclusions).toContain('*.xcodeproj/xcuserdata');
      expect(exclusions).toContain('*.dSYM');
      expect(exclusions).toContain('*.framework');
      expect(exclusions).toContain('*.app');
      expect(exclusions).toContain('*.swiftmodule');
      
      // Check for universal exclusions
      expect(exclusions).toContain('.git');
      expect(exclusions).toContain('.DS_Store');
    });

    it('should include custom exclusions', () => {
      const customExclusions = ['CustomBuild', 'Pods'];
      const exclusions = manager.getOptimizedExclusions('swift', 'balanced', customExclusions);
      
      expect(exclusions).toContain('CustomBuild');
      expect(exclusions).toContain('Pods');
    });

    it('should handle performance profiles correctly', () => {
      const conservativeExclusions = manager.getOptimizedExclusions('swift', 'conservative', []);
      const aggressiveExclusions = manager.getOptimizedExclusions('swift', 'aggressive', []);
      
      // Conservative should have fewer exclusions
      expect(conservativeExclusions.length).toBeLessThan(aggressiveExclusions.length);
      
      // Conservative should still include critical exclusions
      expect(conservativeExclusions).toContain('.git');
      expect(conservativeExclusions).toContain('DerivedData');
    });
  });

  describe('Watchman configuration generation', () => {
    it('should generate Swift-specific watchman config', async () => {
      const config = {
        version: '1.0' as const,
        projectType: 'swift' as ProjectType,
        targets: [],
        watchman: {
          excludeDirs: ['CustomDir'],
          maxFileEvents: 5000,
          recrawlThreshold: 10,
          settlingDelay: 500,
          projectType: 'swift' as ProjectType,
        },
        notifications: {
          successSound: 'Glass' as const,
          failureSound: 'Basso' as const,
        },
      };

      const watchmanConfig = await manager.generateWatchmanConfig(config);
      
      // Check basic structure
      expect(watchmanConfig.ignore_dirs).toBeInstanceOf(Array);
      expect(watchmanConfig.ignore_vcs).toEqual(['.git', '.svn', '.hg', '.bzr']);
      
      // Check performance settings
      expect(watchmanConfig.idle_reap_age_seconds).toBe(300);
      expect(watchmanConfig.gc_age_seconds).toBe(259200);
      expect(watchmanConfig.gc_interval_seconds).toBe(86400);
      expect(watchmanConfig.max_files).toBe(5000);
      expect(watchmanConfig.settle).toBe(500);
      
      // Check Swift-specific optimizations
      expect(watchmanConfig.defer).toContain('*.xcodeproj/**');
      expect(watchmanConfig.defer).toContain('*.xcworkspace/**');
    });

    it('should include custom exclusions in watchman config', async () => {
      const config = {
        version: '1.0' as const,
        projectType: 'swift' as ProjectType,
        targets: [],
        watchman: {
          excludeDirs: ['Pods', 'Carthage'],
          maxFileEvents: 10000,
          recrawlThreshold: 5,
          settlingDelay: 1000,
          projectType: 'swift' as ProjectType,
        },
        notifications: {
          successSound: 'Glass' as const,
          failureSound: 'Basso' as const,
        },
      };

      const watchmanConfig = await manager.generateWatchmanConfig(config);
      const ignoreDirs = watchmanConfig.ignore_dirs as string[];
      
      expect(ignoreDirs).toContain('Pods');
      expect(ignoreDirs).toContain('Carthage');
    });
  });

  describe('Watch pattern normalization', () => {
    it('should normalize simple extension patterns', () => {
      expect(manager.normalizeWatchPattern('*.swift')).toBe('**/*.swift');
      expect(manager.normalizeWatchPattern('*.ts')).toBe('**/*.ts');
    });

    it('should normalize relative path patterns', () => {
      expect(manager.normalizeWatchPattern('./*.swift')).toBe('**/*.swift');
      expect(manager.normalizeWatchPattern('./src/*.ts')).toBe('./src/**/*.ts');
    });

    it('should normalize directory patterns', () => {
      expect(manager.normalizeWatchPattern('src/*.swift')).toBe('src/**/*.swift');
      expect(manager.normalizeWatchPattern('Sources/*.swift')).toBe('Sources/**/*.swift');
    });

    it('should handle trailing slashes', () => {
      expect(manager.normalizeWatchPattern('src/')).toBe('src/**');
      expect(manager.normalizeWatchPattern('Sources/')).toBe('Sources/**');
    });

    it('should not modify already normalized patterns', () => {
      expect(manager.normalizeWatchPattern('**/*.swift')).toBe('**/*.swift');
      expect(manager.normalizeWatchPattern('src/**/*.ts')).toBe('src/**/*.ts');
    });

    it('should not modify patterns with existing **', () => {
      expect(manager.normalizeWatchPattern('src/**/test/*.swift')).toBe('src/**/test/*.swift');
    });

    it('should validate patterns and warn about problematic ones', () => {
      const warnSpy = vi.spyOn(logger, 'warn');
      
      manager.validateWatchPattern('.git/**');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('includes commonly excluded directory')
      );
      
      manager.validateWatchPattern('node_modules/**');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('includes commonly excluded directory')
      );
    });
  });

  describe('Configuration validation', () => {
    it('should validate all watch patterns in config', () => {
      const validateSpy = vi.spyOn(manager, 'validateWatchPattern');
      
      const config = {
        version: '1.0' as const,
        projectType: 'swift' as ProjectType,
        targets: [
          {
            name: 'app',
            type: 'app-bundle' as const,
            enabled: true,
            buildCommand: 'xcodebuild',
            outputPath: './build/App.app',
            bundleId: 'com.example.app',
            watchPaths: ['**/*.swift', 'Resources/**'],
            settlingDelay: 1000,
          },
        ],
        watchman: {
          excludeDirs: [],
          maxFileEvents: 10000,
          recrawlThreshold: 5,
          settlingDelay: 1000,
          projectType: 'swift' as ProjectType,
        },
        notifications: {
          successSound: 'Glass' as const,
          failureSound: 'Basso' as const,
        },
      };

      manager.validateConfiguration(config);
      
      expect(validateSpy).toHaveBeenCalledWith('**/*.swift');
      expect(validateSpy).toHaveBeenCalledWith('Resources/**');
    });

    it('should throw on invalid watch patterns', () => {
      const config = {
        version: '1.0' as const,
        projectType: 'swift' as ProjectType,
        targets: [
          {
            name: 'app',
            type: 'app-bundle' as const,
            enabled: true,
            buildCommand: 'xcodebuild',
            outputPath: './build/App.app',
            bundleId: 'com.example.app',
            watchPaths: ['', null as any], // Invalid patterns
            settlingDelay: 1000,
          },
        ],
        watchman: {
          excludeDirs: [],
          maxFileEvents: 10000,
          recrawlThreshold: 5,
          settlingDelay: 1000,
          projectType: 'swift' as ProjectType,
        },
        notifications: {
          successSound: 'Glass' as const,
          failureSound: 'Basso' as const,
        },
      };

      expect(() => manager.validateConfiguration(config)).toThrow();
    });
  });
});