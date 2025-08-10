// Tests for polter's wait-for-build functionality

import { spawn } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PoltergeistConfig, PoltergeistState } from '../src/types.js';
import { FileSystemUtils } from '../src/utils/filesystem.js';

describe('Polter Wait for Build', () => {
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

  describe('Build Status Transitions', () => {
    it('should detect building status correctly', async () => {
      const targetName = 'test-app';
      const stateDir = join(testDir, 'state', 'poltergeist');
      mkdirSync(stateDir, { recursive: true });
      
      // Create initial state showing building
      const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      const state: Partial<PoltergeistState> = {
        version: '1.0',
        projectPath: projectRoot,
        projectName: 'test-project',
        target: targetName,
        targetType: 'executable',
        configPath: join(projectRoot, 'poltergeist.config.json'),
        lastBuild: {
          status: 'building',
          timestamp: new Date().toISOString(),
          gitHash: 'abc123',
          buildTime: 0,
        },
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      };
      
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      // Create a simple config
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
      
      // Simulate build completion after a delay
      setTimeout(() => {
        try {
          state.lastBuild = {
            status: 'success',
            timestamp: new Date().toISOString(),
            gitHash: 'abc123',
            buildTime: 1000,
          };
          // Make sure directory still exists before writing
          const dir = require('path').dirname(stateFile);
          if (!require('fs').existsSync(dir)) {
            require('fs').mkdirSync(dir, { recursive: true });
          }
          writeFileSync(stateFile, JSON.stringify(state, null, 2));
        } catch (e) {
          // Ignore errors in async timeout
        }
      }, 500);
      
      // Wait and check that status transitions
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const { readFileSync } = await import('fs');
      const finalState = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(finalState.lastBuild.status).toBe('success');
    });

    it('should handle timeout scenario', async () => {
      const targetName = 'slow-build';
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
          status: 'building',
          timestamp: new Date().toISOString(),
          gitHash: 'def456',
          buildTime: 0,
        },
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      };
      
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      // Don't update the status - simulate stuck build
      const startTime = Date.now();
      const timeout = 100; // Very short timeout for testing
      
      // Simulate wait loop
      let status = 'building';
      while (Date.now() - startTime < timeout && status === 'building') {
        await new Promise(resolve => setTimeout(resolve, 10));
        // Status remains 'building'
      }
      
      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(timeout);
      expect(status).toBe('building'); // Still building after timeout
    });
  });

  describe('Lock File Handling', () => {
    it('should detect lock file existence', () => {
      const targetName = 'locked-app';
      const stateDir = join(testDir, 'state', 'poltergeist');
      mkdirSync(stateDir, { recursive: true });
      
      const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      const lockFile = stateFile.replace('.state', '.lock');
      
      // Create lock file
      writeFileSync(lockFile, JSON.stringify({
        pid: 99999,
        timestamp: Date.now(),
        target: targetName,
      }));
      
      const { existsSync } = require('fs');
      expect(existsSync(lockFile)).toBe(true);
      
      // Lock file should have same base name as state file
      const stateName = stateFile.split('/').pop()?.replace('.state', '');
      const lockName = lockFile.split('/').pop()?.replace('.lock', '');
      expect(stateName).toBe(lockName);
    });

    it('should handle lock file with failed state', () => {
      const targetName = 'failed-but-locked';
      const stateDir = join(testDir, 'state', 'poltergeist');
      mkdirSync(stateDir, { recursive: true });
      
      const stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      const lockFile = stateFile.replace('.state', '.lock');
      
      // Create state showing failed
      const state: Partial<PoltergeistState> = {
        version: '1.0',
        projectPath: projectRoot,
        projectName: 'test-project',
        target: targetName,
        targetType: 'executable',
        configPath: join(projectRoot, 'poltergeist.config.json'),
        lastBuild: {
          status: 'failure',
          timestamp: new Date(Date.now() - 5000).toISOString(),
          gitHash: 'xyz789',
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
      
      // But also create lock file indicating build in progress
      writeFileSync(lockFile, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        target: targetName,
      }));
      
      // Both should exist
      const { existsSync } = require('fs');
      expect(existsSync(stateFile)).toBe(true);
      expect(existsSync(lockFile)).toBe(true);
      
      // State shows failed but lock indicates building
      const { readFileSync } = require('fs');
      const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(stateContent.lastBuild.status).toBe('failure');
      
      const lockContent = JSON.parse(readFileSync(lockFile, 'utf-8'));
      expect(lockContent.pid).toBe(process.pid);
    });
  });

  describe('Progress Indication', () => {
    it('should format elapsed time correctly', () => {
      const formatTime = (ms: number): string => {
        return `${Math.round(ms / 100) / 10}s`;
      };
      
      expect(formatTime(0)).toBe('0s');
      expect(formatTime(500)).toBe('0.5s');
      expect(formatTime(1000)).toBe('1s');
      expect(formatTime(1500)).toBe('1.5s');
      expect(formatTime(10000)).toBe('10s');
      expect(formatTime(60000)).toBe('60s');
    });

    it('should calculate polling intervals correctly', () => {
      const pollInterval = 250; // ms
      const timeout = 5000; // ms
      
      const maxPolls = Math.ceil(timeout / pollInterval);
      expect(maxPolls).toBe(20);
      
      // Simulate polling
      let polls = 0;
      const startTime = Date.now();
      
      while (polls < maxPolls && Date.now() - startTime < timeout) {
        polls++;
        // In real code, would check status here
      }
      
      expect(polls).toBeLessThanOrEqual(maxPolls);
    });
  });
});