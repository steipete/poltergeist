// Tests for unified state management

import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logger.js';
import { StateManager } from '../src/state.js';
import type { BaseTarget } from '../src/types.js';
import { FileSystemUtils } from '../src/utils/filesystem.js';

// Mock logger
const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

describe('StateManager', () => {
  const projectRoot = '/Users/test/Projects/test-app';
  const stateDir = '/tmp/poltergeist';
  let stateManager: StateManager;

  beforeEach(() => {
    stateManager = new StateManager(projectRoot, mockLogger);
  });

  afterEach(async () => {
    // Cleanup any test state files
    stateManager.stopHeartbeat();
    const stateFiles = await StateManager.listAllStates();
    for (const file of stateFiles) {
      if (file.includes('test-app')) {
        try {
          rmSync(join(stateDir, file));
        } catch {}
      }
    }
  });

  describe('State File Naming', () => {
    it('should generate unique state file names', () => {
      const fileName1 = FileSystemUtils.generateStateFileName(projectRoot, 'cli');
      const fileName2 = FileSystemUtils.generateStateFileName(projectRoot, 'macApp');

      // Extract just the filename if it's a full path (cross-platform compatibility)
      const baseName1 = fileName1.includes('/') || fileName1.includes('\\') 
        ? fileName1.split(/[/\\]/).pop() || fileName1
        : fileName1;
      const baseName2 = fileName2.includes('/') || fileName2.includes('\\')
        ? fileName2.split(/[/\\]/).pop() || fileName2  
        : fileName2;

      expect(baseName1).toMatch(/^test-app-[a-f0-9]{8}-cli\.state$/);
      expect(baseName2).toMatch(/^test-app-[a-f0-9]{8}-macApp\.state$/);
      expect(fileName1).not.toBe(fileName2);
    });

    it('should use consistent hash for same project', () => {
      const fileName1 = FileSystemUtils.generateStateFileName(projectRoot, 'cli');
      const fileName2 = FileSystemUtils.generateStateFileName(projectRoot, 'cli');

      expect(fileName1).toBe(fileName2);
    });
  });

  describe('State Initialization', () => {
    it('should initialize state for executable target', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
        icon: 'assets/cli-icon.png',
      };

      const state = await stateManager.initializeState(target);

      expect(state.version).toBe('1.0');
      expect(state.projectPath).toBe(projectRoot);
      expect(state.projectName).toBe('test-app');
      expect(state.target).toBe('cli');
      expect(state.targetType).toBe('executable');
      expect(state.process.pid).toBe(process.pid);
      expect(state.process.isActive).toBe(true);
      expect(state.appInfo?.iconPath).toBe('assets/cli-icon.png');
    });

    it('should create state file on disk', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
      };

      await stateManager.initializeState(target);

      const stateFile = stateManager.getStateFilePath('cli');
      expect(existsSync(stateFile)).toBe(true);
    });
  });

  describe('Build Status Updates', () => {
    it('should update build status', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
      };

      await stateManager.initializeState(target);

      const buildStatus = {
        targetName: 'cli',
        status: 'success' as const,
        timestamp: new Date().toISOString(),
        duration: 1234,
        buildTime: 1.234,
      };

      await stateManager.updateBuildStatus('cli', buildStatus);

      const state = await stateManager.readState('cli');
      expect(state?.lastBuild).toEqual(buildStatus);
    });
  });

  describe('Lock Detection', () => {
    it('should not be locked for same process', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
      };

      await stateManager.initializeState(target);

      const isLocked = await stateManager.isLocked('cli');
      expect(isLocked).toBe(false);
    });

    it('should detect stale locks', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
      };

      const state = await stateManager.initializeState(target);

      // Manually make the heartbeat old
      state.process.lastHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      state.process.pid = 99999; // Different PID
      await stateManager.writeState('cli');

      const isLocked = await stateManager.isLocked('cli');
      expect(isLocked).toBe(false);
    });
  });

  describe('Heartbeat Mechanism', () => {
    it('should update heartbeat periodically', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
      };

      await stateManager.initializeState(target);
      const initialState = await stateManager.readState('cli');
      const initialHeartbeat = initialState?.process.lastHeartbeat;

      // Start heartbeat
      stateManager.startHeartbeat();

      // Force a state write which updates heartbeat
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Manually trigger a write to update heartbeat
      await stateManager.updateBuildStatus('cli', {
        targetName: 'cli',
        status: 'idle',
        timestamp: new Date().toISOString(),
        duration: 0,
      });

      const updatedState = await stateManager.readState('cli');
      const updatedHeartbeat = updatedState?.process.lastHeartbeat;

      expect(updatedHeartbeat).not.toBe(initialHeartbeat);
      stateManager.stopHeartbeat();
    });
  });

  describe('Cleanup', () => {
    it('should mark process as inactive on cleanup', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
      };

      await stateManager.initializeState(target);
      await stateManager.cleanup();

      const state = await stateManager.readState('cli');
      expect(state?.process.isActive).toBe(false);
    });

    it('should remove state file', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
      };

      await stateManager.initializeState(target);
      const stateFile = stateManager.getStateFilePath('cli');

      await stateManager.removeState('cli');

      expect(existsSync(stateFile)).toBe(false);
    });
  });

  describe('State Discovery', () => {
    it('should list all state files', async () => {
      const target: BaseTarget = {
        name: 'cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        watchPaths: ['src/**/*.ts'],
      };

      await stateManager.initializeState(target);

      const stateFiles = await StateManager.listAllStates();
      const testAppStates = stateFiles.filter((f) => f.includes('test-app'));

      expect(testAppStates.length).toBeGreaterThan(0);
      expect(testAppStates[0]).toMatch(/test-app-.*-cli\.state/);
    });
  });
});
