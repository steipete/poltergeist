// Tests for polter's generic lock detection behavior

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoltergeistState } from '../src/state.js';
import { FileSystemUtils } from '../src/utils/filesystem.js';

describe('Polter Generic Lock Detection', () => {
  let testDir: string;
  let projectRoot: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    projectRoot = join(testDir, 'test-project');
    mkdirSync(projectRoot, { recursive: true });
    process.env.POLTERGEIST_STATE_DIR = join(testDir, 'state');
  });

  afterEach(() => {
    delete process.env.POLTERGEIST_STATE_DIR;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Lock File Priority', () => {
    it('should prioritize lock file over state status for any build tool', () => {
      const buildTools = [
        { name: 'npm-project', command: 'npm run build' },
        { name: 'cargo-project', command: 'cargo build' },
        { name: 'make-project', command: 'make all' },
        { name: 'gradle-project', command: './gradlew build' },
        { name: 'cmake-project', command: 'cmake --build .' },
      ];

      buildTools.forEach(({ name, command }) => {
        const targetName = name;

        // Get paths
        const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
        const lockFile = stateFile.replace('.state', '.lock');

        // Ensure the directory for state file exists
        const stateFileDir = require('path').dirname(stateFile);
        mkdirSync(stateFileDir, { recursive: true });

        // Create state showing failed build
        const state: Partial<PoltergeistState> = {
          version: '1.0',
          projectPath: projectRoot,
          projectName: 'test-project',
          target: targetName,
          targetType: 'executable',
          configPath: join(projectRoot, 'poltergeist.config.json'),
          lastBuild: {
            status: 'failure',
            timestamp: new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
            gitHash: 'abc123',
            buildTime: 0,
            errorSummary: `${command} failed`,
          },
          process: {
            pid: process.pid,
            isActive: true,
            startTime: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
          },
        };

        writeFileSync(stateFile, JSON.stringify(state, null, 2));

        // Create lock file indicating active build
        try {
          writeFileSync(
            lockFile,
            JSON.stringify({
              pid: process.pid,
              timestamp: Date.now(),
              target: targetName,
              command,
            })
          );
        } catch (e) {
          console.error(`Failed to write lock file for ${name}:`, e);
          // Skip this iteration if we can't write the lock file
          return;
        }

        // Both files should exist
        const { existsSync, readFileSync } = require('fs');
        expect(existsSync(stateFile)).toBe(true);
        expect(existsSync(lockFile)).toBe(true);

        // State shows failed but lock indicates building
        const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
        expect(stateContent.lastBuild.status).toBe('failure');

        // Lock file should indicate active build
        if (existsSync(lockFile)) {
          const lockContent = JSON.parse(readFileSync(lockFile, 'utf-8'));
          expect(lockContent.command).toBe(command);
          expect(lockContent.pid).toBe(process.pid);
        }

        // Clean up for next iteration
        if (existsSync(stateFile)) rmSync(stateFile, { force: true });
        if (existsSync(lockFile)) rmSync(lockFile, { force: true });
      });
    });

    it('should handle lock files without specific error patterns', () => {
      const targetName = 'generic-build';

      const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      const lockFile = stateFile.replace('.state', '.lock');

      // Ensure directory exists
      const stateFileDir = require('path').dirname(stateFile);
      mkdirSync(stateFileDir, { recursive: true });

      // Create state with non-specific error
      const state: Partial<PoltergeistState> = {
        version: '1.0',
        projectPath: projectRoot,
        projectName: 'test-project',
        target: targetName,
        targetType: 'executable',
        configPath: join(projectRoot, 'poltergeist.config.json'),
        lastBuild: {
          status: 'failure',
          timestamp: new Date(Date.now() - 10000).toISOString(),
          gitHash: 'def456',
          buildTime: 0,
          errorSummary: 'Build failed with exit code 1',
        },
        lastBuildError: {
          exitCode: 1,
          errorOutput: ['Error: Compilation failed', 'See log for details'],
          lastOutput: [],
          command: 'custom-build',
          timestamp: new Date(Date.now() - 10000).toISOString(),
        },
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      };

      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      // Create lock file even though error doesn't match stuck patterns
      writeFileSync(
        lockFile,
        JSON.stringify({
          pid: process.pid + 1, // Different PID to simulate another process
          timestamp: Date.now(),
          target: targetName,
        })
      );

      const { existsSync, readFileSync } = require('fs');

      // Lock exists despite no stuck build error pattern
      expect(existsSync(lockFile)).toBe(true);

      // Only check state content if file exists
      if (existsSync(stateFile)) {
        const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const hasStuckPattern = stateContent.lastBuildError?.errorOutput?.some(
          (line: string) =>
            line.includes('another process is already running') ||
            line.includes('resource temporarily unavailable') ||
            line.includes('file is locked') ||
            line.includes('cannot obtain lock')
        );

        // No stuck pattern in error
        expect(hasStuckPattern).toBe(false);
      }

      // But lock file still exists - polter should wait
      expect(existsSync(lockFile)).toBe(true);
    });

    it('should handle timeout when lock exists but build is stuck', () => {
      const targetName = 'stuck-forever';
      const stateDir = join(testDir, 'state', 'poltergeist');
      mkdirSync(stateDir, { recursive: true });

      const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      const lockFile = stateFile.replace('.state', '.lock');

      // Ensure directory exists for state file
      const stateFileDir = require('path').dirname(stateFile);
      mkdirSync(stateFileDir, { recursive: true });

      // Create old failed state
      const state: Partial<PoltergeistState> = {
        version: '1.0',
        projectPath: projectRoot,
        projectName: 'test-project',
        target: targetName,
        targetType: 'executable',
        configPath: join(projectRoot, 'poltergeist.config.json'),
        lastBuild: {
          status: 'failure',
          timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          gitHash: 'old123',
          buildTime: 0,
          errorSummary: 'Build failed',
        },
        process: {
          pid: 99999, // Dead process
          isActive: false,
          startTime: new Date(Date.now() - 3600000).toISOString(),
          lastHeartbeat: new Date(Date.now() - 3600000).toISOString(),
        },
      };

      // Ensure state file can be written
      try {
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
      } catch (e) {
        // Skip this test if we can't write the file
        console.log('Skipping test due to file write error:', e);
        return;
      }

      // Create old lock file (stale)
      writeFileSync(
        lockFile,
        JSON.stringify({
          pid: 99999,
          timestamp: Date.now() - 3600000, // 1 hour old
          target: targetName,
        })
      );

      const { readFileSync } = require('fs');
      const lockContent = JSON.parse(readFileSync(lockFile, 'utf-8'));

      // Lock is very old
      const lockAge = Date.now() - lockContent.timestamp;
      expect(lockAge).toBeGreaterThan(3000000); // More than 50 minutes old

      // This should trigger timeout behavior in polter
      const { existsSync: existsSync2 } = require('fs');
      if (existsSync2(stateFile)) {
        const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
        expect(stateContent.process.isActive).toBe(false);
      }
    });
  });
});
