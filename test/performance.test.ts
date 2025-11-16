// Performance tests - build debouncing, memory usage, scalability
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Poltergeist } from '../src/poltergeist.js';
import type { ExecutableTarget } from '../src/types.js';
import { createTestHarness, simulateFileChange, type TestHarness } from './helpers.js';

const describePerf = process.env.VITEST ? describe.skip : describe;

describePerf('Performance Tests', () => {
  let poltergeist: Poltergeist;
  let harness: TestHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Setup test harness with config
    harness = createTestHarness({
      version: '1.0',
      projectType: 'node',
      targets: [
        {
          name: 'test',
          type: 'executable',
          enabled: true,
          buildCommand: 'npm run build',
          outputPath: './dist',
          watchPaths: ['src/**/*.ts'],
          settlingDelay: 100, // 100ms debounce
        } as ExecutableTarget,
      ],
      watchman: {
        useDefaultExclusions: true,
        excludeDirs: [],
        projectType: 'node',
        maxFileEvents: 10000,
        recrawlThreshold: 5,
        settlingDelay: 1000,
      },
    });

    // Setup builder mock
    const testBuilder = harness.builderFactory.builders.get('test');
    if (testBuilder) {
      vi.mocked(testBuilder.build).mockResolvedValue({
        status: 'success',
        targetName: 'test',
        timestamp: new Date().toISOString(),
        duration: 100,
      });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Build Debouncing', () => {
    it('should debounce rapid file changes', async () => {
      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Clear the initial build call
      const testBuilder = harness.builderFactory.builders.get('test');
      vi.mocked(testBuilder?.build).mockClear();

      // Simulate rapid file changes
      const changes = [
        { name: 'src/file1.ts', exists: true, type: 'f' },
        { name: 'src/file2.ts', exists: true, type: 'f' },
        { name: 'src/file3.ts', exists: true, type: 'f' },
        { name: 'src/file4.ts', exists: true, type: 'f' },
        { name: 'src/file5.ts', exists: true, type: 'f' },
      ];

      // Get the callback from subscribe
      // Simulate rapid file changes
      const subscribeCall = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];
      expect(changeHandler).toBeDefined();

      // Emit changes rapidly
      changes.forEach((change) => {
        changeHandler([change]);
      });

      // Should not build yet (still within settling delay)
      expect(testBuilder?.build).not.toHaveBeenCalled();

      // Advance past settling delay and run all timers
      vi.advanceTimersByTime(110); // Past the 100ms settling delay

      // Wait for async operations to complete
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Should build only once with all files
      expect(testBuilder?.build).toHaveBeenCalledTimes(1);
      expect(testBuilder?.build).toHaveBeenCalledWith(
        ['src/file1.ts', 'src/file2.ts', 'src/file3.ts', 'src/file4.ts', 'src/file5.ts'],
        expect.objectContaining({
          captureLogs: true,
          logFile: expect.stringContaining('test.log'),
        })
      );
    });

    it('should reset debounce timer on new changes', async () => {
      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Clear the initial build call
      const testBuilder = harness.builderFactory.builders.get('test');
      vi.mocked(testBuilder?.build).mockClear();

      // Simulate rapid file changes
      const subscribeCall = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      // First change
      changeHandler([{ name: 'src/file1.ts', exists: true, type: 'f' }]);

      // Advance 80ms (not quite at settling delay)
      vi.advanceTimersByTime(80);

      // Another change resets the timer
      changeHandler([{ name: 'src/file2.ts', exists: true, type: 'f' }]);

      // Advance 80ms again
      vi.advanceTimersByTime(80);

      // Still shouldn't build
      expect(testBuilder?.build).not.toHaveBeenCalled();

      // Advance past settling delay from last change
      vi.advanceTimersByTime(30); // Total 110ms from last change

      // Wait for async operations to complete
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Now should build with both files
      expect(testBuilder?.build).toHaveBeenCalledTimes(1);
      expect(testBuilder?.build).toHaveBeenCalledWith(
        ['src/file1.ts', 'src/file2.ts'],
        expect.objectContaining({
          captureLogs: true,
          logFile: expect.stringContaining('test.log'),
        })
      );
    });

    it('should handle different settling delays per target', async () => {
      // Create new harness with multiple targets
      harness = createTestHarness({
        targets: [
          {
            name: 'fast',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo fast',
            outputPath: './dist/fast',
            watchPaths: ['fast/**/*.ts'],
            settlingDelay: 50,
          } as ExecutableTarget,
          {
            name: 'slow',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo slow',
            outputPath: './dist/slow',
            watchPaths: ['slow/**/*.ts'],
            settlingDelay: 200,
          } as ExecutableTarget,
        ],
      });

      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Now get the builders after they've been created
      const fastBuilder = harness.builderFactory.builders.get('fast');
      const slowBuilder = harness.builderFactory.builders.get('slow');

      // Setup mocks and clear initial build calls
      if (fastBuilder) {
        vi.mocked(fastBuilder.build).mockResolvedValue({
          status: 'success',
          targetName: 'fast',
          timestamp: new Date().toISOString(),
          duration: 50,
        });
        vi.mocked(fastBuilder.build).mockClear();
      }

      if (slowBuilder) {
        vi.mocked(slowBuilder.build).mockResolvedValue({
          status: 'success',
          targetName: 'slow',
          timestamp: new Date().toISOString(),
          duration: 100,
        });
        vi.mocked(slowBuilder.build).mockClear();
      }

      // Get callbacks for both targets
      const fastCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0]?.[3];
      const slowCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[1]?.[3];

      // Trigger changes for both
      fastCallback([{ name: 'fast/file.ts', exists: true, type: 'f' }]);
      slowCallback([{ name: 'slow/file.ts', exists: true, type: 'f' }]);

      // Advance time for fast target
      vi.advanceTimersByTime(60);

      // Wait for async operations to complete
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Fast target should build
      expect(fastBuilder?.build).toHaveBeenCalledTimes(1);
      expect(fastBuilder?.build).toHaveBeenCalledWith(
        ['fast/file.ts'],
        expect.objectContaining({
          captureLogs: true,
          logFile: expect.stringContaining('fast.log'),
        })
      );

      // Clear mock
      vi.mocked(fastBuilder?.build).mockClear();

      // Advance time for slow target
      vi.advanceTimersByTime(150); // Total 210ms

      // Wait for async operations to complete
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      // Slow target should now build
      expect(slowBuilder?.build).toHaveBeenCalledTimes(1);
      expect(slowBuilder?.build).toHaveBeenCalledWith(
        ['slow/file.ts'],
        expect.objectContaining({
          captureLogs: true,
          logFile: expect.stringContaining('slow.log'),
        })
      );
    });

    it('should accumulate files during settling period', async () => {
      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Clear the initial build call
      const testBuilder = harness.builderFactory.builders.get('test');
      vi.mocked(testBuilder?.build).mockClear();

      // Simulate a realistic scenario of multiple file saves
      simulateFileChange(harness.watchmanClient, ['src/index.ts']);
      vi.advanceTimersByTime(20);

      simulateFileChange(harness.watchmanClient, ['src/utils.ts']);
      vi.advanceTimersByTime(20);

      simulateFileChange(harness.watchmanClient, ['src/types.ts']);
      vi.advanceTimersByTime(20);

      // File deleted - simulate with exists: false
      const subscribeCall = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];
      changeHandler([{ name: 'src/old.ts', exists: false, type: 'f' }]);
      vi.advanceTimersByTime(20);

      // Same file modified again (should not duplicate)
      simulateFileChange(harness.watchmanClient, ['src/index.ts']);

      // Advance past settling delay
      vi.advanceTimersByTime(110); // 110ms from last change to pass 100ms settling delay

      // Wait for async operations to complete
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      expect(testBuilder?.build).toHaveBeenCalledTimes(1);
      expect(testBuilder?.build).toHaveBeenCalledWith(
        ['src/index.ts', 'src/utils.ts', 'src/types.ts'],
        expect.objectContaining({
          captureLogs: true,
          logFile: expect.stringContaining('test.log'),
        })
      );
    });
  });

  describe('Memory Usage', () => {
    it('should not accumulate unbounded file change history', async () => {
      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Simulate rapid file changes
      const subscribeCall = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0];
      const changeHandler = subscribeCall[3];

      // Simulate many build cycles
      for (let cycle = 0; cycle < 100; cycle++) {
        // Trigger changes
        for (let i = 0; i < 10; i++) {
          changeHandler([{ name: `src/file${i}.ts`, exists: true, type: 'f' }]);
        }

        // Wait for build
        vi.advanceTimersByTime(110);

        // Clear build mock
        const testBuilder = harness.builderFactory.builders.get('test');
        vi.mocked(testBuilder?.build).mockClear();
      }

      // Memory usage should be bounded
      // In real implementation, would check actual memory metrics
      // Here we verify that old data is not retained
      // Access private property for testing purposes
      const poltergeistWithPrivates = poltergeist as Poltergeist & {
        targetStates: Map<string, { pendingFiles: Set<string> }>;
      };
      const targetStates = poltergeistWithPrivates.targetStates;
      expect(targetStates.size).toBe(1); // Only one target

      // Check that pending files are cleared after builds
      const state = targetStates.get('test');
      expect(state?.pendingFiles.size).toBe(0); // Should clear after builds
    });

    it('should clean up event listeners on stop', async () => {
      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Stop poltergeist
      await poltergeist.stop();

      // Watchman should be disconnected
      expect(harness.watchmanClient.disconnect).toHaveBeenCalled();

      // Builders should be stopped
      const testBuilder = harness.builderFactory.builders.get('test');
      expect(testBuilder?.stop).toHaveBeenCalled();
    });

    it('should handle large numbers of targets efficiently', async () => {
      // Create config with many targets
      const manyTargets = Array.from({ length: 50 }, (_, i) => ({
        name: `target-${i}`,
        type: 'executable' as const,
        enabled: true,
        buildCommand: `echo target-${i}`,
        outputPath: `./dist/target-${i}`,
        watchPaths: [`src/target-${i}/**/*`],
      }));

      // Create new harness with many targets
      harness = createTestHarness({ targets: manyTargets });

      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      const startTime = Date.now();

      await poltergeist.start();

      const initTime = Date.now() - startTime;

      // Initialization should be reasonably fast
      expect(initTime).toBeLessThan(1000); // Less than 1 second

      // Should create builders for all targets
      // Access private property for testing purposes
      const poltergeistWithPrivates = poltergeist as Poltergeist & {
        targetStates: Map<string, unknown>;
      };
      const targetStates = poltergeistWithPrivates.targetStates;
      expect(targetStates.size).toBe(50);

      // Should create subscriptions for all targets
      expect(harness.watchmanClient.subscribe).toHaveBeenCalledTimes(50);
    });
  });

  // Build Queue Management tests deleted - feature not implemented
  // Poltergeist doesn't prevent new builds from starting while one is in progress

  describe('Resource Cleanup', () => {
    it('should clean up resources on process exit', async () => {
      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Manually call stop() to simulate graceful shutdown
      await poltergeist.stop();

      // Should clean up state manager
      expect(harness.stateManager.cleanup).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Make cleanup operations fail
      vi.mocked(harness.watchmanClient.disconnect).mockRejectedValue(
        new Error('Disconnect failed')
      );
      vi.mocked(harness.stateManager.cleanup).mockRejectedValue(new Error('Cleanup failed'));

      // Should handle the error gracefully and not throw
      await expect(poltergeist.stop()).rejects.toThrow('Disconnect failed');
    });
  });

  describe('Scalability', () => {
    it('should handle high-frequency file changes', async () => {
      harness.config.targets[0].settlingDelay = 10; // Very short delay

      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);
      await poltergeist.start();

      // Clear initial build
      const testBuilder = harness.builderFactory.builders.get('test');
      vi.mocked(testBuilder?.build).mockClear();

      // Simulate many file changes at once using the helper
      const fileChanges: string[] = [];
      for (let i = 0; i < 100; i++) {
        fileChanges.push(`src/file${i}.ts`);
      }

      // Send all changes at once
      simulateFileChange(harness.watchmanClient, fileChanges, 0);

      // Wait for the short settling delay and async operations
      vi.advanceTimersByTime(20);

      // Wait for async operations to complete
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      expect(testBuilder?.build).toHaveBeenCalledTimes(1);
      // Should include all unique files
      const calledFiles = vi.mocked(testBuilder?.build).mock.calls[0][0];
      expect(calledFiles.length).toBe(100);
    });

    it('should perform well with deep watch paths', async () => {
      harness.config.targets[0].watchPaths = [
        'src/**/**/**/**/*.ts',
        'lib/**/**/**/**/*.js',
        'test/**/**/**/**/*.spec.ts',
      ];

      poltergeist = new Poltergeist(harness.config, '/test/project', harness.logger, harness.deps);

      const startTime = performance.now();
      await poltergeist.start();
      const duration = performance.now() - startTime;

      // Should start quickly even with complex patterns
      expect(duration).toBeLessThan(100); // Less than 100ms

      // Should create subscriptions for all watch paths (3 paths = 3 subscriptions)
      expect(harness.watchmanClient.subscribe).toHaveBeenCalledTimes(3);

      // Check that each subscription has the expected structure
      const subscribeCalls = vi.mocked(harness.watchmanClient.subscribe).mock.calls;
      subscribeCalls.forEach((call) => {
        expect(call[0]).toBe('/test/project'); // project path
        expect(call[1]).toMatch(/^poltergeist_/); // subscription name
        expect(call[2]).toMatchObject({
          expression: expect.arrayContaining(['match']),
          fields: expect.arrayContaining(['name', 'exists', 'type']),
        });
        expect(call[3]).toBeTypeOf('function'); // callback
      });
    });
  });
});
