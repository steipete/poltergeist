// Windows-specific StateManager tests - sequential operations only

import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logger.js';
import { StateManager } from '../src/state.js';
import type { BaseTarget } from '../src/types.js';

// Mock logger
const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

describe.runIf(process.platform === 'win32')('StateManager Windows Tests', () => {
  let stateManager: StateManager;
  let testDir: string;
  const projectRoot = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = join(tmpdir(), `poltergeist-windows-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Mock the state directory
    process.env.POLTERGEIST_STATE_DIR = testDir;

    stateManager = new StateManager(projectRoot, mockLogger);
  });

  afterEach(async () => {
    if (stateManager) {
      try {
        stateManager.stopHeartbeat();
        await stateManager.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    }
    delete process.env.POLTERGEIST_STATE_DIR;

    // Windows-safe cleanup
    try {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Basic State Operations', () => {
    it('should handle sequential state initialization and updates', async () => {
      const target: BaseTarget = {
        name: 'windows-sequential-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'echo test',
        watchPaths: ['src/**/*'],
      };

      // Sequential operations to avoid Windows race conditions
      await stateManager.initializeState(target);

      // Small delay between operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      await stateManager.updateBuildStatus('windows-sequential-test', {
        targetName: 'windows-sequential-test',
        status: 'success',
        timestamp: new Date().toISOString(),
        duration: 1000,
      });

      const state = await stateManager.readState('windows-sequential-test');
      expect(state).toBeDefined();
      expect(state?.process.pid).toBe(process.pid);
      expect(state?.lastBuild?.status).toBe('success');
    });

    it('should handle state directory recreation', async () => {
      const target: BaseTarget = {
        name: 'recreation-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'echo test',
        watchPaths: ['src/**/*'],
      };

      // Remove state directory
      rmSync(testDir, { recursive: true, force: true });

      // Should recreate directory and state
      await stateManager.initializeState(target);

      expect(existsSync(testDir)).toBe(true);
      const state = await stateManager.readState('recreation-test');
      expect(state).toBeDefined();
    });

    it('should handle state cleanup gracefully', async () => {
      const target: BaseTarget = {
        name: 'cleanup-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'echo test',
        watchPaths: ['src/**/*'],
      };

      await stateManager.initializeState(target);

      // Cleanup should not throw
      await expect(stateManager.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Windows File System Edge Cases', () => {
    it('should handle long file paths', async () => {
      const longName = 'a'.repeat(100); // Reduced from 200 to avoid Windows path limits
      const target: BaseTarget = {
        name: longName,
        type: 'executable',
        enabled: true,
        buildCommand: 'echo test',
        watchPaths: ['src/**/*'],
      };

      await stateManager.initializeState(target);
      const state = await stateManager.readState(longName);
      expect(state).toBeDefined();
      expect(state?.target).toBe(longName);
    });

    it('should handle state file locking gracefully', async () => {
      const target: BaseTarget = {
        name: 'lock-test',
        type: 'executable',
        enabled: true,
        buildCommand: 'echo test',
        watchPaths: ['src/**/*'],
      };

      await stateManager.initializeState(target);

      // Check lock status
      const isLocked = await stateManager.isLocked('lock-test');
      expect(isLocked).toBe(false); // Own process shouldn't be locked
    });
  });
});
