import { execSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoltergeistConfig } from '../src/types';

describe('poltergeist init - Smart Defaults', () => {
  let tempDir: string;
  let originalCwd: string;
  let cli: string;

  // Helper function to run init command and get config
  function runInitAndGetConfig(args = '--auto'): PoltergeistConfig {
    let result: string;

    // Ensure CLI exists
    if (!existsSync(cli)) {
      throw new Error(`CLI not found at: ${cli}`);
    }

    try {
      result = execSync(`node "${cli}" init ${args}`, {
        stdio: 'pipe',
        cwd: tempDir,
        encoding: 'utf-8',
        env: { ...process.env, NODE_ENV: 'test' },
        shell: process.platform === 'win32' ? 'cmd.exe' : true,
      });
    } catch (error) {
      const errorDetails = error as { message?: string; stdout?: string; stderr?: string };
      throw new Error(
        `Init command failed: ${errorDetails.message || 'Unknown error'}\nStdout: ${errorDetails.stdout || ''}\nStderr: ${errorDetails.stderr || ''}\nCLI path: ${cli}\nCWD: ${tempDir}`
      );
    }

    const configPath = join(tempDir, 'poltergeist.config.json');
    if (!existsSync(configPath)) {
      throw new Error(`Config file not created at ${configPath}. Output: ${result}`);
    }

    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }

  beforeEach(() => {
    // Store original directory
    originalCwd = process.cwd();
    // Set CLI path before changing directory
    cli = join(originalCwd, 'dist', 'cli.js');
    // Create a temporary directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'poltergeist-test-'));
    process.chdir(tempDir);
  });

  afterEach(() => {
    // Clean up - restore to original directory
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Node.js project', () => {
    beforeEach(() => {
      // Create a minimal package.json to trigger Node.js detection
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          build: 'tsc',
        },
      };
      writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
    });

    it('should generate minimal config without defaults', () => {
      const config = runInitAndGetConfig();

      // Should have essential fields
      expect(config.version).toBe('1.0');
      expect(config.projectType).toBe('node');
      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].name).toBe('dev');
      expect(config.targets[0].type).toBe('executable');
      expect(config.targets[0].buildCommand).toBe('npm run build');
      expect(config.targets[0].watchPaths).toEqual(['src/**/*.{ts,js}', 'package.json']);

      // Should NOT have default fields
      expect(config.targets[0]).not.toHaveProperty('enabled');
      expect(config.targets[0]).not.toHaveProperty('settlingDelay');
      expect(config.targets[0]).not.toHaveProperty('debounceInterval');
      expect(config).not.toHaveProperty('watchman');
      expect(config).not.toHaveProperty('performance');
      expect(config).not.toHaveProperty('logging');
      expect(config).not.toHaveProperty('notifications');
    });
  });

  describe('CMake project', () => {
    beforeEach(() => {
      // Create a minimal CMakeLists.txt
      const cmakeLists = `
cmake_minimum_required(VERSION 3.10)
project(TestProject)

add_executable(test-app main.cpp)
add_library(test-lib STATIC lib.cpp)
`;
      writeFileSync('CMakeLists.txt', cmakeLists);
      writeFileSync('main.cpp', 'int main() { return 0; }');
      writeFileSync('lib.cpp', 'void foo() {}');
    });

    it('should generate minimal CMake config', { timeout: 10000 }, () => {
      execSync(`node ${cli} init --cmake`, { stdio: 'pipe' });

      const config: PoltergeistConfig = JSON.parse(
        readFileSync('poltergeist.config.json', 'utf-8')
      );

      // Should have CMake-specific structure
      expect(config.projectType).toBe('cmake');
      expect(config.targets.length).toBeGreaterThan(0);

      // Should only have build directory in excludeDirs
      expect(config.watchman?.excludeDirs).toEqual(['build']);

      // Should NOT have these defaults
      expect(config.watchman).not.toHaveProperty('useDefaultExclusions');
      expect(config.watchman).not.toHaveProperty('maxFileEvents');
      expect(config.watchman).not.toHaveProperty('projectType');
      expect(config.watchman).not.toHaveProperty('settlingDelay');
    });
  });

  describe('Swift project', () => {
    beforeEach(() => {
      // Create Package.swift
      const packageSwift = `
// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "TestPackage",
    products: [
        .executable(name: "test-cli", targets: ["TestCLI"])
    ],
    targets: [
        .executableTarget(name: "TestCLI", dependencies: [])
    ]
)`;
      writeFileSync('Package.swift', packageSwift);
      mkdirSync('Sources/TestCLI', { recursive: true });
      writeFileSync('Sources/TestCLI/main.swift', 'print("Hello")');
    });

    it('should generate minimal Swift config', () => {
      const config = runInitAndGetConfig();

      expect(config.projectType).toBe('swift');
      expect(config.targets[0].watchPaths).toContain('Sources/**/*.swift');
      expect(config.targets[0].watchPaths).toContain('Package.swift');

      // Should use default build command
      expect(config.targets[0].buildCommand).toBe('swift build');

      // Should not have verbose settings
      expect(config).not.toHaveProperty('buildScheduling');
      expect(config).not.toHaveProperty('performance.profile');
    });
  });

  describe('Xcode project detection', () => {
    it('should detect single .xcodeproj', () => {
      // Create Xcode project structure
      mkdirSync('MyApp.xcodeproj', { recursive: true });
      writeFileSync('MyApp.xcodeproj/project.pbxproj', 'mock pbxproj content');
      mkdirSync('MyApp', { recursive: true });
      writeFileSync('MyApp/AppDelegate.swift', 'import UIKit');

      const config = runInitAndGetConfig();

      expect(config.projectType).toBe('swift');
      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].name).toBe('myapp');
      expect(config.targets[0].type).toBe('app-bundle');
      expect(config.targets[0].buildCommand).toContain('xcodebuild -project MyApp.xcodeproj');
      expect(config.targets[0].bundleId).toBe('com.example.myapp');
      expect(config.targets[0].watchPaths).toContain('./**/*.swift');
    });

    it('should detect .xcworkspace and use correct build command', () => {
      mkdirSync('MyApp.xcworkspace', { recursive: true });
      writeFileSync('MyApp.xcworkspace/contents.xcworkspacedata', 'mock workspace');
      mkdirSync('MyApp', { recursive: true });
      writeFileSync('MyApp/main.swift', 'print("Hello")');

      const config = runInitAndGetConfig();

      expect(config.projectType).toBe('swift');
      expect(config.targets[0].buildCommand).toContain('xcodebuild -workspace MyApp.xcworkspace');
    });

    it('should handle iOS projects in subdirectory', () => {
      mkdirSync('ios/MyApp-iOS.xcodeproj', { recursive: true });
      writeFileSync('ios/MyApp-iOS.xcodeproj/project.pbxproj', 'mock pbxproj');
      writeFileSync('ios/Info.plist', '<plist></plist>');

      const config = runInitAndGetConfig();

      expect(config.targets[0].name).toBe('myapp-ios');
      expect(config.targets[0].enabled).toBe(false); // iOS disabled by default
      expect(config.targets[0].buildCommand).toContain('cd ios &&');
      expect(config.targets[0].bundleId).toContain('.ios');
    });

    it('should detect build script and prefer it over xcodebuild', () => {
      mkdirSync('mac/MyApp.xcodeproj', { recursive: true });
      mkdirSync('mac/scripts', { recursive: true });
      writeFileSync('mac/MyApp.xcodeproj/project.pbxproj', 'mock pbxproj');
      writeFileSync('mac/scripts/build.sh', '#!/bin/bash\nxcodebuild');
      if (process.platform !== 'win32') {
        require('fs').chmodSync('mac/scripts/build.sh', '755');
      }

      const config = runInitAndGetConfig();

      expect(config.targets[0].buildCommand).toBe(
        'cd mac && ./scripts/build.sh --configuration Debug'
      );
      expect(config.targets[0].buildCommand).not.toContain('xcodebuild -project');
    });

    it('should handle multiple Xcode projects', () => {
      // Create multiple projects
      mkdirSync('App.xcodeproj', { recursive: true });
      writeFileSync('App.xcodeproj/project.pbxproj', 'mock');

      mkdirSync('ios/App-iOS.xcodeproj', { recursive: true });
      writeFileSync('ios/App-iOS.xcodeproj/project.pbxproj', 'mock');

      mkdirSync('mac/App-Mac.xcodeproj', { recursive: true });
      writeFileSync('mac/App-Mac.xcodeproj/project.pbxproj', 'mock');

      const config = runInitAndGetConfig();

      expect(config.targets).toHaveLength(3);
      expect(config.targets.map((t) => t.name)).toContain('app');
      expect(config.targets.map((t) => t.name)).toContain('app-ios');
      expect(config.targets.map((t) => t.name)).toContain('appmac');

      // iOS should be disabled
      const iosTarget = config.targets.find((t) => t.name.includes('ios'));
      expect(iosTarget?.enabled).toBe(false);

      // Others should be enabled (enabled defaults to true, so it may be undefined in minimal config)
      const otherTargets = config.targets.filter((t) => !t.name.includes('ios'));
      otherTargets.forEach((target) => {
        expect(target.enabled === undefined || target.enabled === true).toBe(true);
      });
    });

    it('should generate unique target names for duplicate project names', () => {
      mkdirSync('VibeTunnel.xcworkspace', { recursive: true });
      writeFileSync('VibeTunnel.xcworkspace/contents.xcworkspacedata', 'mock');

      mkdirSync('mac/VibeTunnel.xcodeproj', { recursive: true });
      writeFileSync('mac/VibeTunnel.xcodeproj/project.pbxproj', 'mock');

      const config = runInitAndGetConfig();

      // Should have unique names
      const targetNames = config.targets.map((t) => t.name);
      expect(new Set(targetNames).size).toBe(targetNames.length);
    });

    it('should detect VibeTunnel-specific bundle IDs', () => {
      mkdirSync('vibetunnel/VibeTunnel.xcodeproj', { recursive: true });
      writeFileSync('vibetunnel/VibeTunnel.xcodeproj/project.pbxproj', 'mock');

      const config = runInitAndGetConfig();

      expect(config.targets[0].bundleId).toBe('sh.vibetunnel.vibetunnel');
    });

    it('should create minimal Swift configuration', () => {
      mkdirSync('MyApp.xcodeproj', { recursive: true });
      writeFileSync('MyApp.xcodeproj/project.pbxproj', 'mock');

      const config = runInitAndGetConfig();

      // Check minimal config structure
      expect(config.version).toBe('1.0');
      expect(config.projectType).toBe('swift');
      expect(config.targets).toHaveLength(1);
      expect(config.targets[0].type).toBe('app-bundle');

      // Should NOT have these properties in minimal config
      expect(config).not.toHaveProperty('watchman');
      expect(config).not.toHaveProperty('notifications');
      expect(config).not.toHaveProperty('performance');
      expect(config).not.toHaveProperty('buildScheduling');
      expect(config).not.toHaveProperty('logging');
    });
  });

  describe('Dry run mode', () => {
    beforeEach(() => {
      writeFileSync('package.json', '{"name": "test"}');
    });

    it('should show minimal config without creating file', () => {
      const output = execSync(`node "${cli}" init --auto --dry-run`, {
        encoding: 'utf-8',
        cwd: tempDir,
      });

      // Should show preview
      expect(output).toContain('--dry-run mode');
      expect(output).toContain('poltergeist.config.json:');

      // Config should not be created
      const configPath = join(tempDir, 'poltergeist.config.json');
      expect(existsSync(configPath)).toBe(false);

      // Output should show minimal config
      expect(output).not.toContain('"enabled": true');
      expect(output).not.toContain('"settlingDelay": 1000');
      expect(output).not.toContain('"useDefaultExclusions": true');
    });
  });
});

// Helper to write files in tests
function writeFileSync(path: string, content: string): void {
  require('fs').writeFileSync(path, content, 'utf-8');
}

function mkdirSync(path: string, options?: { recursive?: boolean }): void {
  require('fs').mkdirSync(path, options);
}
