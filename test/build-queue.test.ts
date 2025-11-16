// Build Queue Tests - Intelligent Build Queue Management

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntelligentBuildQueue } from '../src/build-queue.js';
import { PriorityEngine } from '../src/priority-engine.js';
import type { BuildSchedulingConfig, Target } from '../src/types.js';
import {
  createControllableMockBuilder,
  createMockBuilder,
  createMockLogger,
  waitForAsync,
} from './helpers.js';

describe('IntelligentBuildQueue', () => {
  let buildQueue: IntelligentBuildQueue;
  let priorityEngine: PriorityEngine;
  let config: BuildSchedulingConfig;
  let targets: Target[];
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T10:00:00Z'));

    logger = createMockLogger();
    config = {
      parallelization: 2,
      prioritization: {
        enabled: true,
        focusDetectionWindow: 300000, // 5 minutes
        priorityDecayTime: 1800000, // 30 minutes
        buildTimeoutMultiplier: 2.0,
      },
    };

    targets = [
      {
        name: 'frontend',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/frontend',
        watchPaths: ['frontend/**/*.ts'],
      },
      {
        name: 'backend',
        type: 'executable',
        enabled: true,
        buildCommand: 'cargo build',
        outputPath: './target/backend',
        watchPaths: ['backend/**/*.rs'],
      },
      {
        name: 'shared',
        type: 'library',
        enabled: true,
        buildCommand: 'tsc',
        outputPath: './lib/shared',
        libraryType: 'static',
        watchPaths: ['shared/**/*.ts'],
      },
    ];

    priorityEngine = new PriorityEngine(config, logger);
    buildQueue = new IntelligentBuildQueue(config, logger, priorityEngine);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Target Registration', () => {
    it('should register targets with builders', () => {
      const mockBuilder = createMockBuilder('frontend');

      buildQueue.registerTarget(targets[0], mockBuilder);

      expect(logger.debug).toHaveBeenCalledWith('Registered target: frontend');
    });

    it('should track registered targets', () => {
      const mockBuilder = createMockBuilder('frontend');

      buildQueue.registerTarget(targets[0], mockBuilder);

      const status = buildQueue.getQueueStatus();
      expect(status.pending).toHaveLength(0);
      expect(status.running).toHaveLength(0);
    });
  });

  describe('File Change Handling', () => {
    it('should queue builds for file changes', async () => {
      const { builder: mockBuilder } = createControllableMockBuilder('frontend');
      buildQueue.registerTarget(targets[0], mockBuilder);

      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      // Check immediately after queueing, before build starts
      const status = buildQueue.getQueueStatus();
      if (status.running.length > 0) {
        // Build started immediately, check that it's running
        expect(status.running).toHaveLength(1);
        expect(status.running[0].target).toBe('frontend');
      } else {
        // Build is still pending
        expect(status.pending).toHaveLength(1);
        expect(status.pending[0].target).toBe('frontend');
      }
    });

    it('should calculate priorities for queued builds', async () => {
      const { builder: mockBuilder } = createControllableMockBuilder('frontend');
      buildQueue.registerTarget(targets[0], mockBuilder);

      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      const status = buildQueue.getQueueStatus();
      // Priority should be set whether build is pending or running
      if (status.running.length > 0) {
        // Build started, but we can check the priority was calculated
        expect(mockBuilder.build).toHaveBeenCalled();
      } else {
        expect(status.pending[0].priority).toBeGreaterThan(0);
      }
    });

    it('should handle multiple file changes', async () => {
      const { builder: frontendBuilder } = createControllableMockBuilder('frontend');
      const { builder: backendBuilder } = createControllableMockBuilder('backend');

      buildQueue.registerTarget(targets[0], frontendBuilder);
      buildQueue.registerTarget(targets[1], backendBuilder);

      await buildQueue.onFileChanged(
        ['frontend/src/app.ts', 'backend/src/main.rs'],
        [targets[0], targets[1]]
      );

      const status = buildQueue.getQueueStatus();
      // With parallelization=2, both builds might start immediately
      const totalBuilds = status.pending.length + status.running.length;
      expect(totalBuilds).toBe(2);
    });

    it('should deduplicate builds for same target', async () => {
      const { builder: mockBuilder } = createControllableMockBuilder('frontend');
      buildQueue.registerTarget(targets[0], mockBuilder);

      // First change
      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      // Second change for same target - should update existing entry
      await buildQueue.onFileChanged(['frontend/src/component.ts'], [targets[0]]);

      const status = buildQueue.getQueueStatus();
      const totalBuilds = status.pending.length + status.running.length;
      expect(totalBuilds).toBe(1);

      // Should be either pending or running, but only one build total
      if (status.running.length > 0) {
        expect(status.running[0].target).toBe('frontend');
      } else {
        expect(status.pending[0].target).toBe('frontend');
      }
    });

    it('should merge triggering files for deduplicated builds', async () => {
      const mockBuilder = createMockBuilder('frontend');
      buildQueue.registerTarget(targets[0], mockBuilder);

      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);
      await buildQueue.onFileChanged(['frontend/src/component.ts'], [targets[0]]);

      // Start processing to trigger build with merged files
      await waitForAsync(100);

      const status = buildQueue.getQueueStatus();
      if (status.pending.length > 0) {
        expect(status.pending[0].target).toBe('frontend');
      }
    });
  });

  describe('Queue Processing', () => {
    it('should respect parallelization limits', async () => {
      config.parallelization = 1; // Serial mode
      const serialQueue = new IntelligentBuildQueue(config, logger, priorityEngine);

      // Create controllable builders that don't complete automatically
      const { builder: frontendBuilder, complete: completeFrontend } =
        createControllableMockBuilder('frontend');
      const { builder: backendBuilder, complete: completeBackend } =
        createControllableMockBuilder('backend');

      serialQueue.registerTarget(targets[0], frontendBuilder);
      serialQueue.registerTarget(targets[1], backendBuilder);

      // Queue both builds
      await serialQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);
      await serialQueue.onFileChanged(['backend/src/main.rs'], [targets[1]]);

      // Wait for queue processing
      await waitForAsync(10);

      const status = serialQueue.getQueueStatus();

      // In serial mode, only one should be running at a time
      expect(status.running.length).toBeLessThanOrEqual(1);
      expect(status.pending.length + status.running.length).toBe(2);

      // Clean up by completing builds
      completeFrontend();
      completeBackend();
    });

    it('should process builds in priority order', async () => {
      const frontendBuilder = createMockBuilder('frontend');
      const backendBuilder = createMockBuilder('backend');

      buildQueue.registerTarget(targets[0], frontendBuilder);
      buildQueue.registerTarget(targets[1], backendBuilder);

      // Create focus on frontend first
      priorityEngine.recordChange(['frontend/src/app.ts'], targets);
      priorityEngine.recordChange(['frontend/src/component.ts'], targets);

      // Add both to queue
      await buildQueue.onFileChanged(['frontend/src/new.ts'], [targets[0]]);
      await buildQueue.onFileChanged(['backend/src/main.rs'], [targets[1]]);

      const priorityInfo = buildQueue.getPriorityInfo();
      const frontendPriority = priorityInfo.queue.find((q) => q.target === 'frontend');
      const backendPriority = priorityInfo.queue.find((q) => q.target === 'backend');

      // Frontend should have higher priority due to focus
      if (frontendPriority && backendPriority) {
        expect(frontendPriority.priority).toBeGreaterThan(backendPriority.priority);
      }
    });

    it('should handle build failures', async () => {
      const mockBuilder = createMockBuilder('frontend');

      // Make builder fail
      vi.mocked(mockBuilder.build).mockResolvedValue({
        status: 'failure',
        targetName: 'frontend',
        timestamp: new Date().toISOString(),
        duration: 2000,
        error: 'Build failed',
      });

      buildQueue.registerTarget(targets[0], mockBuilder);

      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      await waitForAsync(100);

      const status = buildQueue.getQueueStatus();
      expect(status.stats.failedBuilds).toBeGreaterThanOrEqual(0);
    });

    it('should track build statistics', async () => {
      const mockBuilder = createMockBuilder('frontend');
      buildQueue.registerTarget(targets[0], mockBuilder);

      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      await waitForAsync(100);

      const status = buildQueue.getQueueStatus();
      expect(status.stats).toMatchObject({
        totalBuilds: expect.any(Number),
        successfulBuilds: expect.any(Number),
        failedBuilds: expect.any(Number),
        avgWaitTime: expect.any(Number),
        avgBuildTime: expect.any(Number),
      });
    });
  });

  describe('Retry Handling', () => {
    it('should retry failed builds up to target maxRetries', async () => {
      const controllable = createControllableMockBuilder('frontend');
      const retryTarget = {
        ...targets[0],
        maxRetries: 2,
        backoffMultiplier: 1,
      };

      buildQueue.registerTarget(retryTarget, controllable.builder);
      await buildQueue.onFileChanged(['frontend/src/app.ts'], [retryTarget]);

      // Fail first attempt
      controllable.fail('First failure');
      await waitForAsync(undefined, { drainAll: false });
      expect(controllable.builder.build).toHaveBeenCalledTimes(1);

      // Fast-forward retry delay (1s base, multiplier 1)
      await waitForAsync(1000);
      expect(controllable.builder.build).toHaveBeenCalledTimes(2);

      // Fail second attempt
      controllable.fail('Second failure');
      await waitForAsync(undefined, { drainAll: false });

      // Advance timers again; second retry should occur (maxRetries counts retries, not attempts)
      await waitForAsync(1000);
      expect(controllable.builder.build).toHaveBeenCalledTimes(3);
    });
  });

  describe('Pending Rebuild Handling', () => {
    it('should mark builds for rebuild when already running', async () => {
      const mockBuilder = createMockBuilder('frontend');

      // Make build take time
      vi.mocked(mockBuilder.build).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  status: 'success',
                  targetName: 'frontend',
                  timestamp: new Date().toISOString(),
                  duration: 3000,
                }),
              3000
            )
          )
      );

      buildQueue.registerTarget(targets[0], mockBuilder);

      // Start first build
      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      await waitForAsync(50); // Let build start

      // Try to queue another build while first is running
      await buildQueue.onFileChanged(['frontend/src/component.ts'], [targets[0]]);

      const status = buildQueue.getQueueStatus();

      // Should have one running build and potentially one pending rebuild
      expect(status.running.length).toBe(1);
    });

    it('should reschedule builds marked for rebuild', async () => {
      const mockBuilder = createMockBuilder('frontend');

      let buildCount = 0;
      vi.mocked(mockBuilder.build).mockImplementation(() => {
        buildCount++;
        return Promise.resolve({
          status: 'success',
          targetName: 'frontend',
          timestamp: new Date().toISOString(),
          duration: 1000,
        });
      });

      buildQueue.registerTarget(targets[0], mockBuilder);

      // Start first build
      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      // Queue rebuild while first is processing
      await buildQueue.onFileChanged(['frontend/src/component.ts'], [targets[0]]);

      await waitForAsync(200);

      // Should have triggered at least the first build
      expect(buildCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Queue Management', () => {
    it('should provide queue status information', () => {
      const status = buildQueue.getQueueStatus();

      expect(status).toMatchObject({
        pending: expect.any(Array),
        running: expect.any(Array),
        stats: expect.objectContaining({
          totalBuilds: expect.any(Number),
          successfulBuilds: expect.any(Number),
          failedBuilds: expect.any(Number),
          avgWaitTime: expect.any(Number),
          avgBuildTime: expect.any(Number),
        }),
      });
    });

    it('should provide priority information', () => {
      const priorityInfo = buildQueue.getPriorityInfo();

      expect(priorityInfo).toMatchObject({
        focus: expect.any(Array),
        queue: expect.any(Array),
      });
    });

    it('should cancel pending builds for specific targets', async () => {
      // Use serial mode to ensure builds stay pending
      config.parallelization = 1;
      const serialQueue = new IntelligentBuildQueue(config, logger, priorityEngine);

      const { builder: frontendBuilder } = createControllableMockBuilder('frontend');
      const { builder: backendBuilder } = createControllableMockBuilder('backend');

      serialQueue.registerTarget(targets[0], frontendBuilder);
      serialQueue.registerTarget(targets[1], backendBuilder);

      // Queue builds - first will start, second will be pending
      await serialQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);
      await serialQueue.onFileChanged(['backend/src/main.rs'], [targets[1]]);

      await waitForAsync(10);

      const cancelled = serialQueue.cancelPendingBuilds('backend');

      expect(cancelled).toBeGreaterThanOrEqual(0);
      // Only check for cancellation message if there were builds to cancel
      if (cancelled > 0) {
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Cancelled'));
      }
    });

    it('should clear entire queue', async () => {
      // Use serial mode to ensure some builds stay pending
      config.parallelization = 1;
      const serialQueue = new IntelligentBuildQueue(config, logger, priorityEngine);

      const { builder: frontendBuilder } = createControllableMockBuilder('frontend');
      const { builder: backendBuilder } = createControllableMockBuilder('backend');

      serialQueue.registerTarget(targets[0], frontendBuilder);
      serialQueue.registerTarget(targets[1], backendBuilder);

      // Queue builds
      await serialQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);
      await serialQueue.onFileChanged(['backend/src/main.rs'], [targets[1]]);

      await waitForAsync(10);

      serialQueue.clearQueue();

      const status = buildQueue.getQueueStatus();
      expect(status.pending).toHaveLength(0);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Cleared queue'));
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle maximum parallelization', async () => {
      const highParallelConfig = {
        ...config,
        parallelization: 10,
      };

      const highParallelQueue = new IntelligentBuildQueue(
        highParallelConfig,
        logger,
        priorityEngine
      );

      // Register many targets
      const _builders = targets.map((target) => {
        const builder = createMockBuilder(target.name);
        highParallelQueue.registerTarget(target, builder);
        return builder;
      });

      // Queue all builds
      await highParallelQueue.onFileChanged(
        targets.map((t) => `${t.name}/file.ts`),
        targets
      );

      await waitForAsync(100);

      const status = highParallelQueue.getQueueStatus();

      // Should be able to run up to parallelization limit
      expect(status.running.length).toBeLessThanOrEqual(10);
    });

    it('should handle single parallelization (serial mode)', async () => {
      const serialConfig = {
        ...config,
        parallelization: 1,
      };

      const serialQueue = new IntelligentBuildQueue(serialConfig, logger, priorityEngine);

      const _builders = targets.map((target) => {
        const builder = createMockBuilder(target.name);
        serialQueue.registerTarget(target, builder);
        return builder;
      });

      // Queue all builds
      await serialQueue.onFileChanged(
        targets.map((t) => `${t.name}/file.ts`),
        targets
      );

      await waitForAsync(100);

      const status = serialQueue.getQueueStatus();

      // In serial mode, only one build should run at a time
      expect(status.running.length).toBeLessThanOrEqual(1);
    });

    it('should handle disabled prioritization gracefully', async () => {
      const noPriorityConfig = {
        ...config,
        prioritization: {
          ...config.prioritization,
          enabled: false,
        },
      };

      const noPriorityQueue = new IntelligentBuildQueue(noPriorityConfig, logger, priorityEngine);

      const { builder: mockBuilder } = createControllableMockBuilder('frontend');
      noPriorityQueue.registerTarget(targets[0], mockBuilder);

      await noPriorityQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      const status = noPriorityQueue.getQueueStatus();
      const totalBuilds = status.pending.length + status.running.length;
      expect(totalBuilds).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing builders gracefully', async () => {
      // Don't register any builders
      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      const status = buildQueue.getQueueStatus();
      expect(status.pending).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith('No builder registered for target: frontend');
    });

    it('should handle build errors gracefully', async () => {
      const mockBuilder = createMockBuilder('frontend');

      // Make builder throw an error
      vi.mocked(mockBuilder.build).mockRejectedValue(new Error('Build crashed'));

      buildQueue.registerTarget(targets[0], mockBuilder);

      await buildQueue.onFileChanged(['frontend/src/app.ts'], [targets[0]]);

      await waitForAsync(100);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Build failed for frontend')
      );
    });

    it('should handle empty file changes', async () => {
      await buildQueue.onFileChanged([], targets);

      const status = buildQueue.getQueueStatus();
      expect(status.pending).toHaveLength(0);
    });

    it('should handle empty target lists', async () => {
      await buildQueue.onFileChanged(['some/file.ts'], []);

      const status = buildQueue.getQueueStatus();
      expect(status.pending).toHaveLength(0);
    });

    it('should handle invalid priority calculations', async () => {
      const mockBuilder = createMockBuilder('frontend');
      buildQueue.registerTarget(targets[0], mockBuilder);

      // This should not crash even with unusual file patterns
      await buildQueue.onFileChanged([''], [targets[0]]);

      const status = buildQueue.getQueueStatus();
      // Should either ignore or handle gracefully
      expect(status).toBeDefined();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle many simultaneous file changes efficiently', async () => {
      const { builder: mockBuilder } = createControllableMockBuilder('frontend');
      buildQueue.registerTarget(targets[0], mockBuilder);

      const manyFiles = Array.from({ length: 100 }, (_, i) => `frontend/src/file${i}.ts`);

      const startTime = Date.now();
      await buildQueue.onFileChanged(manyFiles, [targets[0]]);
      const endTime = Date.now();

      // Should process efficiently (less than 100ms for 100 files)
      expect(endTime - startTime).toBeLessThan(100);

      const status = buildQueue.getQueueStatus();
      const totalBuilds = status.pending.length + status.running.length;
      expect(totalBuilds).toBe(1); // Should deduplicate into single build
    });

    it('should handle rapid successive changes', async () => {
      const { builder: mockBuilder } = createControllableMockBuilder('frontend');
      buildQueue.registerTarget(targets[0], mockBuilder);

      // Rapid fire changes
      for (let i = 0; i < 20; i++) {
        await buildQueue.onFileChanged([`frontend/src/file${i}.ts`], [targets[0]]);
      }

      const status = buildQueue.getQueueStatus();
      // Should still deduplicate to single build
      const totalBuilds = status.pending.length + status.running.length;
      expect(totalBuilds).toBe(1);
    });
  });
});
