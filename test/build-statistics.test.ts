// Tests for build statistics tracking functionality

import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger.js';
import { StateManager } from '../src/state.js';
import type { BuildStatus } from '../src/types.js';

describe('Build Statistics', () => {
  let stateManager: StateManager;
  let tempDir: string;
  let logger: any;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    
    // Mock logger
    logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    // Create state manager instance
    stateManager = new StateManager(tempDir, logger);
  });

  afterEach(() => {
    // Cleanup
    vi.clearAllMocks();
  });

  describe('StateManager.updateBuildStatus', () => {
    it('tracks build statistics for successful builds', async () => {
      // Initialize state for a target
      await stateManager.initializeState({
        name: 'test-target',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      });

      // First successful build
      const firstBuild: BuildStatus = {
        status: 'success',
        timestamp: new Date().toISOString(),
        duration: 3000,
      };
      await stateManager.updateBuildStatus('test-target', firstBuild);

      // Read state to verify
      let state = await stateManager.readState('test-target');
      expect(state?.buildStats).toBeDefined();
      expect(state?.buildStats?.successfulBuilds).toHaveLength(1);
      expect(state?.buildStats?.averageDuration).toBe(3000);
      expect(state?.buildStats?.minDuration).toBe(3000);
      expect(state?.buildStats?.maxDuration).toBe(3000);

      // Second successful build
      const secondBuild: BuildStatus = {
        status: 'success',
        timestamp: new Date().toISOString(),
        duration: 5000,
      };
      await stateManager.updateBuildStatus('test-target', secondBuild);

      state = await stateManager.readState('test-target');
      expect(state?.buildStats?.successfulBuilds).toHaveLength(2);
      expect(state?.buildStats?.averageDuration).toBe(4000); // (3000 + 5000) / 2
      expect(state?.buildStats?.minDuration).toBe(3000);
      expect(state?.buildStats?.maxDuration).toBe(5000);
    });

    it('uses buildTime field if duration is not available', async () => {
      await stateManager.initializeState({
        name: 'test-target',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      });

      const build: BuildStatus = {
        status: 'success',
        timestamp: new Date().toISOString(),
        buildTime: 2500, // Using buildTime instead of duration
      };
      await stateManager.updateBuildStatus('test-target', build);

      const state = await stateManager.readState('test-target');
      expect(state?.buildStats?.successfulBuilds[0].duration).toBe(2500);
      expect(state?.buildStats?.averageDuration).toBe(2500);
    });

    it('does not track statistics for failed builds', async () => {
      await stateManager.initializeState({
        name: 'test-target',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      });

      const failedBuild: BuildStatus = {
        status: 'failure',
        timestamp: new Date().toISOString(),
        duration: 1000,
        error: 'Build failed',
      };
      await stateManager.updateBuildStatus('test-target', failedBuild);

      const state = await stateManager.readState('test-target');
      expect(state?.buildStats).toBeUndefined();
    });

    it('keeps only the last 10 successful builds', async () => {
      await stateManager.initializeState({
        name: 'test-target',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      });

      // Add 12 successful builds
      for (let i = 1; i <= 12; i++) {
        const build: BuildStatus = {
          status: 'success',
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          duration: i * 1000,
        };
        await stateManager.updateBuildStatus('test-target', build);
      }

      const state = await stateManager.readState('test-target');
      expect(state?.buildStats?.successfulBuilds).toHaveLength(10);
      
      // Should keep the last 10 (3000ms to 12000ms)
      const durations = state?.buildStats?.successfulBuilds.map(b => b.duration) || [];
      expect(durations[0]).toBe(3000);
      expect(durations[9]).toBe(12000);
      
      // Average should be (3+4+5+6+7+8+9+10+11+12) * 1000 / 10 = 7500
      expect(state?.buildStats?.averageDuration).toBe(7500);
    });

    it('correctly calculates min and max durations', async () => {
      await stateManager.initializeState({
        name: 'test-target',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      });

      const builds = [
        { duration: 5000 },
        { duration: 2000 },
        { duration: 8000 },
        { duration: 3000 },
      ];

      for (const build of builds) {
        await stateManager.updateBuildStatus('test-target', {
          status: 'success',
          timestamp: new Date().toISOString(),
          duration: build.duration,
        });
      }

      const state = await stateManager.readState('test-target');
      expect(state?.buildStats?.minDuration).toBe(2000);
      expect(state?.buildStats?.maxDuration).toBe(8000);
      expect(state?.buildStats?.averageDuration).toBe(4500); // (5000+2000+8000+3000)/4
    });

    it('does not track statistics for builds without duration', async () => {
      await stateManager.initializeState({
        name: 'test-target',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      });

      const buildWithoutDuration: BuildStatus = {
        status: 'success',
        timestamp: new Date().toISOString(),
        // No duration or buildTime field
      };
      await stateManager.updateBuildStatus('test-target', buildWithoutDuration);

      const state = await stateManager.readState('test-target');
      expect(state?.buildStats).toBeUndefined();
    });

    it('preserves existing statistics when updating other build info', async () => {
      await stateManager.initializeState({
        name: 'test-target',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      });

      // First successful build with stats
      await stateManager.updateBuildStatus('test-target', {
        status: 'success',
        timestamp: new Date().toISOString(),
        duration: 3000,
      });

      // Update with a building status (should preserve stats)
      await stateManager.updateBuildStatus('test-target', {
        status: 'building',
        timestamp: new Date().toISOString(),
      });

      const state = await stateManager.readState('test-target');
      expect(state?.buildStats).toBeDefined();
      expect(state?.buildStats?.successfulBuilds).toHaveLength(1);
      expect(state?.buildStats?.averageDuration).toBe(3000);
    });
  });

  describe('Integration with getStatus', () => {
    it('includes buildStats in status output', async () => {
      await stateManager.initializeState({
        name: 'test-target',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      });

      // Add some successful builds
      for (let i = 1; i <= 3; i++) {
        await stateManager.updateBuildStatus('test-target', {
          status: 'success',
          timestamp: new Date().toISOString(),
          duration: i * 2000,
        });
      }

      const state = await stateManager.readState('test-target');
      expect(state?.buildStats).toBeDefined();
      expect(state?.buildStats?.averageDuration).toBe(4000); // (2000+4000+6000)/3
      expect(state?.buildStats?.successfulBuilds).toHaveLength(3);
    });
  });
});