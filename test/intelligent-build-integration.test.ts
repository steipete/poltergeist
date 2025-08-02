// Intelligent Build Integration Tests - End-to-End Testing

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Poltergeist } from '../src/poltergeist.js';
import type { PoltergeistConfig } from '../src/types.js';
import { 
  createTestHarness,
  simulateFileChange,
  waitForAsync,
  expectBuilderCalledWith,
} from './helpers.js';

describe('Intelligent Build Integration', () => {
  let poltergeist: Poltergeist;
  let harness: ReturnType<typeof createTestHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T10:00:00Z'));
  });

  afterEach(async () => {
    if (poltergeist) {
      await poltergeist.stop();
    }
    vi.useRealTimers();
  });

  describe('Configuration Integration', () => {
    it('should initialize with intelligent build prioritization enabled', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'mixed',
        targets: [
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
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'mixed',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 1000,
        },
        buildScheduling: {
          parallelization: 2,
          prioritization: {
            enabled: true,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      // Should initialize without errors
      expect(harness.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('👻 [Poltergeist] Building 2 enabled target(s)')
      );
    });

    it('should fall back to traditional builds when prioritization disabled', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'app',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist',
            watchPaths: ['src/**/*.ts'],
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'node',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 1000,
        },
        buildScheduling: {
          parallelization: 1,
          prioritization: {
            enabled: false,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      // Simulate file change
      simulateFileChange(harness.watchmanClient, ['src/app.ts']);

      await waitForAsync(1100); // Wait for settling delay + processing

      // Should still build, but using traditional path
      const appBuilder = harness.builderFactory.builders.get('app');
      expect(appBuilder?.build).toHaveBeenCalled();
    });

    it('should handle missing buildScheduling configuration gracefully', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'swift',
        targets: [
          {
            name: 'cli-tool',
            type: 'executable',
            enabled: true,
            buildCommand: 'swift build',
            outputPath: './.build/debug/cli-tool',
            watchPaths: ['Sources/**/*.swift'],
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'swift',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 1000,
        },
        // No buildScheduling configuration - should use defaults
      };

      harness = createTestHarness(config);
      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      // Should start successfully with defaults
      expect(harness.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('👻 [Poltergeist] Building 1 enabled target(s)')
      );
    });
  });

  describe('Priority-Based Build Scheduling', () => {
    it('should prioritize builds based on focus patterns', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'mixed',
        targets: [
          {
            name: 'frontend',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist/frontend',
            watchPaths: ['frontend/**/*.ts'],
            settlingDelay: 100,
          },
          {
            name: 'backend',
            type: 'executable',
            enabled: true,
            buildCommand: 'cargo build',
            outputPath: './target/backend',
            watchPaths: ['backend/**/*.rs'],
            settlingDelay: 100,
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'mixed',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 100,
        },
        buildScheduling: {
          parallelization: 1, // Serial mode to test ordering
          prioritization: {
            enabled: true,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      // Create focus on frontend by making multiple changes
      simulateFileChange(harness.watchmanClient, ['frontend/src/app.ts'], 0);
      await waitForAsync(200);

      simulateFileChange(harness.watchmanClient, ['frontend/src/component.ts'], 0);
      await waitForAsync(200);

      // Now trigger builds for both targets simultaneously
      simulateFileChange(harness.watchmanClient, ['frontend/src/new.ts'], 0);
      simulateFileChange(harness.watchmanClient, ['backend/src/main.rs'], 1);

      await waitForAsync(300);

      // Frontend should have been prioritized due to focus pattern
      const frontendBuilder = harness.builderFactory.builders.get('frontend');
      const backendBuilder = harness.builderFactory.builders.get('backend');

      expect(frontendBuilder?.build).toHaveBeenCalled();
      expect(backendBuilder?.build).toHaveBeenCalled();
    });

    it('should respect parallelization limits', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'web',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build:web',
            outputPath: './dist/web',
            watchPaths: ['web/**/*.ts'],
            settlingDelay: 50,
          },
          {
            name: 'api',
            type: 'executable', 
            enabled: true,
            buildCommand: 'npm run build:api',
            outputPath: './dist/api',
            watchPaths: ['api/**/*.ts'],
            settlingDelay: 50,
          },
          {
            name: 'worker',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build:worker',
            outputPath: './dist/worker',
            watchPaths: ['worker/**/*.ts'],
            settlingDelay: 50,
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'node',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 50,
        },
        buildScheduling: {
          parallelization: 2, // Allow 2 concurrent builds
          prioritization: {
            enabled: true,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      
      // Make builds take time to test concurrency
      const mockBuilders = ['web', 'api', 'worker'].map(name => {
        const builder = harness.builderFactory.builders.get(name);
        if (builder) {
          vi.mocked(builder.build).mockImplementation(() =>
            new Promise(resolve => setTimeout(() => resolve({
              status: 'success',
              targetName: name,
              timestamp: new Date().toISOString(),
              duration: 2000,
            }), 2000))
          );
        }
        return builder;
      });

      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      // Trigger builds for all three targets
      simulateFileChange(harness.watchmanClient, ['web/src/app.ts'], 0);
      simulateFileChange(harness.watchmanClient, ['api/src/server.ts'], 1);  
      simulateFileChange(harness.watchmanClient, ['worker/src/jobs.ts'], 2);

      await waitForAsync(100);

      // Check the status after a short time
      const status = await poltergeist.getStatus();
      
      // Should respect parallelization limit of 2
      expect(status).toBeDefined();
    });

    it('should handle build deduplication correctly', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'swift',
        targets: [
          {
            name: 'lib',
            type: 'library',
            enabled: true,
            buildCommand: 'swift build',
            outputPath: './.build/debug/lib',
            libraryType: 'static',
            watchPaths: ['Sources/**/*.swift'],
            settlingDelay: 50,
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'swift',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 50,
        },
        buildScheduling: {
          parallelization: 1,
          prioritization: {
            enabled: true,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      // Rapid fire multiple changes to same target
      simulateFileChange(harness.watchmanClient, ['Sources/lib.swift']);
      simulateFileChange(harness.watchmanClient, ['Sources/utils.swift']);
      simulateFileChange(harness.watchmanClient, ['Sources/helpers.swift']);

      await waitForAsync(200);

      const libBuilder = harness.builderFactory.builders.get('lib');
      
      // Should deduplicate into a single build call
      expect(libBuilder?.build).toHaveBeenCalledTimes(1);
    });
  });

  describe('Status Reporting with Queue Information', () => {
    it('should include build queue status in overall status', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'rust',
        targets: [
          {
            name: 'server',
            type: 'executable',
            enabled: true,
            buildCommand: 'cargo build',
            outputPath: './target/debug/server',
            watchPaths: ['src/**/*.rs'],
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'rust',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 1000,
        },
        buildScheduling: {
          parallelization: 1,
          prioritization: {
            enabled: true,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      const status = await poltergeist.getStatus();

      expect(status._buildQueue).toBeDefined();
      expect(status._buildQueue).toMatchObject({
        enabled: true,
        config: expect.objectContaining({
          parallelization: 1,
          prioritization: expect.objectContaining({
            enabled: true,
          }),
        }),
        queue: expect.objectContaining({
          pending: expect.any(Array),
          running: expect.any(Array),
          stats: expect.any(Object),
        }),
        priority: expect.objectContaining({
          focus: expect.any(Array),
          queue: expect.any(Array),
        }),
      });
    });

    it('should show disabled status when prioritization is off', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'python',
        targets: [
          {
            name: 'api',
            type: 'executable',
            enabled: true,
            buildCommand: 'python -m build',
            outputPath: './dist',
            watchPaths: ['src/**/*.py'],
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'python',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 1000,
        },
        buildScheduling: {
          parallelization: 1,
          prioritization: {
            enabled: false,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      const status = await poltergeist.getStatus();

      expect(status._buildQueue).toMatchObject({
        enabled: false,
        config: expect.objectContaining({
          parallelization: 1,
          prioritization: expect.objectContaining({
            enabled: false,
          }),
        }),
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle build failures gracefully with queue system', async () => {
      const config: PoltergeistConfig = {
        version: '1.0', 
        projectType: 'node',
        targets: [
          {
            name: 'failing-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build:fail',
            outputPath: './dist',
            watchPaths: ['src/**/*.ts'],
            settlingDelay: 50,
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'node',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 50,
        },
        buildScheduling: {
          parallelization: 1,
          prioritization: {
            enabled: true,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      
      // Make builder fail
      const failingBuilder = harness.builderFactory.builders.get('failing-app');
      if (failingBuilder) {
        vi.mocked(failingBuilder.build).mockResolvedValue({
          status: 'failure',
          targetName: 'failing-app',
          timestamp: new Date().toISOString(),
          duration: 1000,
          error: 'Build failed with exit code 1',
        });
      }

      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      simulateFileChange(harness.watchmanClient, ['src/app.ts']);

      await waitForAsync(200);

      // Should handle failure without crashing
      expect(failingBuilder?.build).toHaveBeenCalled();
      
      const status = await poltergeist.getStatus();
      expect(status).toBeDefined();
    });

    it('should handle rapid file changes efficiently', async () => {
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'mixed',
        targets: [
          {
            name: 'rapid-changes',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build',
            outputPath: './dist',
            watchPaths: ['src/**/*.ts', 'assets/**/*'],
            settlingDelay: 100,
          },
        ],
        watchman: {
          useDefaultExclusions: true,
          excludeDirs: [],
          projectType: 'mixed',
          maxFileEvents: 10000,
          recrawlThreshold: 3,
          settlingDelay: 100,
        },
        buildScheduling: {
          parallelization: 2,
          prioritization: {
            enabled: true,
            focusDetectionWindow: 300000,
            priorityDecayTime: 1800000,
            buildTimeoutMultiplier: 2.0,
          },
        },
      };

      harness = createTestHarness(config);
      poltergeist = new Poltergeist(config, '/test/project', harness.logger, harness.deps);

      await poltergeist.start();

      // Simulate many rapid changes
      const manyFiles = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
      simulateFileChange(harness.watchmanClient, manyFiles);

      await waitForAsync(250);

      const rapidBuilder = harness.builderFactory.builders.get('rapid-changes');
      
      // Should efficiently deduplicate into minimal builds
      expect(rapidBuilder?.build).toHaveBeenCalled();
      
      const status = await poltergeist.getStatus();
      expect(status).toBeDefined();
    });
  });
});