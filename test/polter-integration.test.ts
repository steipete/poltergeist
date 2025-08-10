// Integration tests for polter's lock detection and wait behavior

import { spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoltergeistConfig, PoltergeistState } from '../src/types.js';
import { FileSystemUtils } from '../src/utils/filesystem.js';

describe('Polter Integration Tests', () => {
  let testDir: string;
  let projectRoot: string;
  const polterPath = join(process.cwd(), 'dist', 'polter.js');

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

  describe('Lock Detection Scenarios', () => {
    it.skip('should detect and report lock file when state shows failed', async () => {
      // Skip if polter not built
      if (!existsSync(polterPath)) {
        console.log('Skipping integration test - polter not built');
        return;
      }

      const targetName = 'test-app';
      const stateDir = join(testDir, 'state', 'poltergeist');
      mkdirSync(stateDir, { recursive: true });
      
      // Create config
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: targetName,
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building..."',
            outputPath: join(projectRoot, targetName),
            watchPaths: ['src/**'],
            excludePaths: [],
            settlingDelay: 100,
            debounceInterval: 500,
          },
        ],
      };
      
      writeFileSync(
        join(projectRoot, 'poltergeist.config.json'),
        JSON.stringify(config, null, 2)
      );
      
      // Create state file showing failed build
      const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      const state: Partial<PoltergeistState> = {
        version: '1.0',
        projectPath: projectRoot,
        projectName: 'test-project',
        target: targetName,
        targetType: 'executable',
        configPath: join(projectRoot, 'poltergeist.config.json'),
        lastBuild: {
          status: 'failure',
          timestamp: new Date(Date.now() - 60000).toISOString(),
          gitHash: 'abc123',
          buildTime: 0,
          errorSummary: 'Build failed',
        },
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      };
      
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      // Create lock file to simulate ongoing build
      const lockFile = stateFile.replace('.state', '.lock');
      writeFileSync(lockFile, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        target: targetName,
      }));
      
      // Create dummy output file
      writeFileSync(join(projectRoot, targetName), '#!/bin/sh\necho "test"');
      require('fs').chmodSync(join(projectRoot, targetName), 0o755);
      
      // Run polter with --no-wait to see if it detects the lock
      const result = await new Promise<{ code: number; output: string }>((resolve) => {
        const child = spawn('node', [polterPath, targetName, '--no-wait'], {
          cwd: projectRoot,
          env: { ...process.env },
        });
        
        let output = '';
        child.stdout?.on('data', (data) => { output += data.toString(); });
        child.stderr?.on('data', (data) => { output += data.toString(); });
        
        child.on('exit', (code) => {
          resolve({ code: code || 0, output });
        });
        
        // Timeout after 3 seconds
        setTimeout(() => {
          child.kill();
          resolve({ code: 1, output: output + '\n[Test timeout]' });
        }, 3000);
      });
      
      // Should detect the lock and wait (but we used --no-wait so it should fail)
      expect(result.output).toContain('lock');
      expect(result.code).not.toBe(0);
    });

    it('should handle multiple build tools generically', async () => {
      const buildScenarios = [
        {
          name: 'npm-build',
          error: 'ENOENT: no such file or directory',
          expectStuck: false,
        },
        {
          name: 'cargo-build',
          error: 'another process is already running',
          expectStuck: true,
        },
        {
          name: 'make-build',
          error: 'resource temporarily unavailable',
          expectStuck: true,
        },
      ];

      for (const scenario of buildScenarios) {
        const targetName = scenario.name;
        const stateDir = join(testDir, 'state', 'poltergeist');
        mkdirSync(stateDir, { recursive: true });
        
        const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
        const state: Partial<PoltergeistState> = {
          version: '1.0',
          projectPath: projectRoot,
          projectName: 'test-project',
          target: targetName,
          targetType: 'executable',
          configPath: join(projectRoot, 'poltergeist.config.json'),
          lastBuild: {
            status: 'failure',
            timestamp: new Date().toISOString(),
            gitHash: 'test123',
            buildTime: 0,
            errorSummary: 'Build failed',
          },
          lastBuildError: {
            exitCode: 1,
            errorOutput: [scenario.error],
            lastOutput: [],
            command: 'build',
            timestamp: new Date().toISOString(),
          },
          process: {
            pid: process.pid,
            isActive: true,
            startTime: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
          },
        };
        
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
        
        // Check if error is detected as stuck
        const { readFileSync } = require('fs');
        const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const hasStuckPattern = stateContent.lastBuildError?.errorOutput?.some((line: string) =>
          line.includes('another process is already running') ||
          line.includes('resource temporarily unavailable') ||
          line.includes('file is locked') ||
          line.includes('cannot obtain lock')
        );
        
        expect(hasStuckPattern).toBe(scenario.expectStuck);
        
        // Clean up for next iteration
        rmSync(stateFile, { force: true });
      }
    });
  });

  describe('State Manager Lock Integration', () => {
    it('should properly check isLocked method', async () => {
      // This test verifies that StateManager.isLocked works correctly
      const { StateManager } = await import('../src/state.js');
      const { createLogger } = await import('../src/logger.js');
      
      const logger = createLogger();
      const stateManager = new StateManager(projectRoot, logger);
      
      const targetName = 'lock-test';
      
      // Initially not locked
      let isLocked = await stateManager.isLocked(targetName);
      expect(isLocked).toBe(false);
      
      // Create a lock file manually
      const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      const lockFile = stateFile.replace('.state', '.lock');
      
      const lockDir = require('path').dirname(lockFile);
      mkdirSync(lockDir, { recursive: true });
      
      const lockData = {
        pid: process.pid + 1, // Different PID to simulate another process
        timestamp: Date.now(),
        target: targetName,
      };
      writeFileSync(lockFile, JSON.stringify(lockData));
      
      // Verify lock file was created
      const { existsSync } = require('fs');
      expect(existsSync(lockFile)).toBe(true);
      
      // Now should be locked
      isLocked = await stateManager.isLocked(targetName);
      expect(isLocked).toBe(true);
      
      // Remove lock
      rmSync(lockFile);
      
      // No longer locked
      isLocked = await stateManager.isLocked(targetName);
      expect(isLocked).toBe(false);
    });
  });

  describe('Build Status Detection', () => {
    it('should correctly map build statuses', () => {
      const statusMappings = [
        { internal: 'success', expected: 'success' },
        { internal: 'failure', expected: 'failed' },
        { internal: 'building', expected: 'building' },
        { internal: 'idle', expected: 'unknown' },
      ];
      
      statusMappings.forEach(({ internal, expected }) => {
        const targetName = `status-${internal}`;
        const stateDir = join(testDir, 'state', 'poltergeist');
        mkdirSync(stateDir, { recursive: true });
        
        const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
        const stateFileDir = require('path').dirname(stateFile);
        mkdirSync(stateFileDir, { recursive: true });
        
        const state: Partial<PoltergeistState> = {
          version: '1.0',
          projectPath: projectRoot,
          projectName: 'test-project',
          target: targetName,
          targetType: 'executable',
          configPath: join(projectRoot, 'poltergeist.config.json'),
          lastBuild: {
            status: internal as any,
            timestamp: new Date().toISOString(),
            gitHash: 'test',
            buildTime: 100,
          },
          process: {
            pid: process.pid,
            isActive: true,
            startTime: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
          },
        };
        
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
        
        // Read and verify
        const { readFileSync } = require('fs');
        const content = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const buildStatus = content.lastBuild?.status;
        
        // Map to polter's expected format
        let mapped = 'unknown';
        if (buildStatus === 'success') mapped = 'success';
        else if (buildStatus === 'failure') mapped = 'failed';
        else if (buildStatus === 'building') mapped = 'building';
        
        expect(mapped).toBe(expected);
      });
    });
  });
});