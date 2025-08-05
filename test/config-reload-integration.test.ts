// Configuration reloading integration tests

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestHarness } from '../src/factories.js';
import type { PoltergeistConfig } from '../src/types.js';

describe('Configuration Reloading Integration', () => {
  const baseConfig: PoltergeistConfig = {
    version: '1.0',
    projectType: 'node',
    targets: [
      {
        name: 'web-app',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build:web',
        outputPath: './dist/web-app.js',
        watchPaths: ['src/web/**/*.ts'],
        settlingDelay: 1000,
      },
      {
        name: 'api-server',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build:api',
        outputPath: './dist/api-server.js',
        watchPaths: ['src/api/**/*.ts'],
        settlingDelay: 1500,
      },
    ],
    watchman: {
      useDefaultExclusions: true,
      excludeDirs: ['node_modules', 'dist'],
      projectType: 'node',
      maxFileEvents: 10000,
      recrawlThreshold: 5,
      settlingDelay: 1000,
    },
    notifications: {
      enabled: false,
    },
  };

  let harness: ReturnType<typeof createTestHarness>;

  beforeEach(() => {
    harness = createTestHarness(baseConfig);

    // Create proper mock logger
    harness.logger.info = vi.fn();
    harness.logger.error = vi.fn();
    harness.logger.warn = vi.fn();
    harness.logger.debug = vi.fn();

    vi.clearAllMocks();
  });

  describe('Multi-Target Configuration Changes', () => {
    test('should handle complex multi-target changes simultaneously', async () => {
      const configPath = '/test/poltergeist.config.json';
      const enhancedMocks = {
        ...harness.mocks,
        watchmanConfigManager: {
          ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
          suggestOptimizations: vi.fn().mockResolvedValue([]),
          normalizeWatchPattern: vi.fn().mockImplementation((pattern: string) => pattern),
          validateWatchPattern: vi.fn(),
          createExclusionExpressions: vi.fn().mockReturnValue([]),
        },
      };

      const poltergeist = new (await import('../src/poltergeist.js')).Poltergeist(
        baseConfig,
        '/test/project',
        harness.logger,
        enhancedMocks,
        configPath
      );

      const newConfig: PoltergeistConfig = {
        ...baseConfig,
        targets: [
          // Keep web-app but modify it
          {
            name: 'web-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build:web:optimized', // Changed
            outputPath: './dist/web-app.js',
            watchPaths: ['src/web/**/*.ts', 'src/shared/**/*.ts'], // Added path
            settlingDelay: 800, // Changed
          },
          // Remove api-server (not in new config)
          // Add new target
          {
            name: 'worker-service',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build:worker',
            outputPath: './dist/worker.js',
            watchPaths: ['src/worker/**/*.ts'],
            settlingDelay: 1200,
          },
          // Add disabled target
          {
            name: 'test-runner',
            type: 'executable',
            enabled: false, // Disabled
            buildCommand: 'npm run build:test',
            outputPath: './dist/test-runner.js',
            watchPaths: ['src/test/**/*.ts'],
            settlingDelay: 1000,
          },
        ],
      };

      const detectChanges = (poltergeist as any).detectConfigChanges.bind(poltergeist);
      const applyChanges = (poltergeist as any).applyConfigChanges.bind(poltergeist);

      const changes = detectChanges(baseConfig, newConfig);

      // Verify detection
      expect(changes.targetsAdded).toHaveLength(2); // worker-service and test-runner
      expect(changes.targetsAdded.map((t) => t.name)).toEqual(['worker-service', 'test-runner']);

      expect(changes.targetsRemoved).toHaveLength(1); // api-server
      expect(changes.targetsRemoved).toEqual(['api-server']);

      expect(changes.targetsModified).toHaveLength(1); // web-app
      expect(changes.targetsModified[0].name).toBe('web-app');

      // Apply changes
      await applyChanges(newConfig, changes);

      // Verify only enabled targets were created
      const createBuilderCalls = enhancedMocks.builderFactory.createBuilder.mock.calls;
      const createdTargetNames = createBuilderCalls.map((call) => call[0].name);

      expect(createdTargetNames).toContain('web-app'); // Modified
      expect(createdTargetNames).toContain('worker-service'); // Added and enabled
      expect(createdTargetNames).not.toContain('test-runner'); // Added but disabled
    });

    test('should handle target type changes', async () => {
      const configPath = '/test/poltergeist.config.json';
      const enhancedMocks = {
        ...harness.mocks,
        watchmanConfigManager: {
          ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
          suggestOptimizations: vi.fn().mockResolvedValue([]),
          normalizeWatchPattern: vi.fn().mockImplementation((pattern: string) => pattern),
          validateWatchPattern: vi.fn(),
          createExclusionExpressions: vi.fn().mockReturnValue([]),
        },
      };

      const poltergeist = new (await import('../src/poltergeist.js')).Poltergeist(
        baseConfig,
        '/test/project',
        harness.logger,
        enhancedMocks,
        configPath
      );

      const newConfig: PoltergeistConfig = {
        ...baseConfig,
        targets: [
          {
            name: 'web-app',
            type: 'library', // Changed from executable to library
            enabled: true,
            buildCommand: 'npm run build:lib',
            outputPath: './dist/web-app.lib.js',
            watchPaths: ['src/web/**/*.ts'],
            settlingDelay: 1000,
          },
          {
            name: 'api-server',
            type: 'app-bundle', // Changed from executable to app-bundle
            platform: 'macos',
            enabled: true,
            buildCommand: 'npm run build:app',
            bundleId: 'com.example.api',
            watchPaths: ['src/api/**/*.ts'],
            settlingDelay: 1500,
          },
        ],
      };

      const detectChanges = (poltergeist as any).detectConfigChanges.bind(poltergeist);
      const changes = detectChanges(baseConfig, newConfig);

      // Type changes should be detected as modifications
      expect(changes.targetsModified).toHaveLength(2);
      expect(changes.targetsModified.map((t) => t.name)).toEqual(['web-app', 'api-server']);

      const webAppChange = changes.targetsModified.find((t) => t.name === 'web-app');
      expect(webAppChange?.newTarget.type).toBe('library');

      const apiServerChange = changes.targetsModified.find((t) => t.name === 'api-server');
      expect(apiServerChange?.newTarget.type).toBe('app-bundle');
    });
  });

  describe('Global Configuration Changes', () => {
    test('should handle combined global and target changes', async () => {
      const configPath = '/test/poltergeist.config.json';
      const enhancedMocks = {
        ...harness.mocks,
        watchmanConfigManager: {
          ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
          suggestOptimizations: vi.fn().mockResolvedValue([]),
          normalizeWatchPattern: vi.fn().mockImplementation((pattern: string) => pattern),
          validateWatchPattern: vi.fn(),
          createExclusionExpressions: vi.fn().mockReturnValue([]),
        },
      };

      const poltergeist = new (await import('../src/poltergeist.js')).Poltergeist(
        baseConfig,
        '/test/project',
        harness.logger,
        enhancedMocks,
        configPath
      );

      const newConfig: PoltergeistConfig = {
        ...baseConfig,
        // Change watchman config
        watchman: {
          useDefaultExclusions: false, // Changed
          excludeDirs: ['node_modules', 'dist', 'coverage'], // Added coverage
          projectType: 'mixed', // Changed
          maxFileEvents: 20000, // Changed
          recrawlThreshold: 10, // Changed
          settlingDelay: 2000, // Changed
        },
        // Enable notifications
        notifications: {
          enabled: true, // Changed
          buildSuccess: true,
          buildFailed: true,
          icon: './assets/icon.png',
        },
        // Add build scheduling
        buildScheduling: {
          parallelization: 3,
          prioritization: {
            enabled: true,
            focusDetectionWindow: 240000,
            priorityDecayTime: 1200000,
            buildTimeoutMultiplier: 1.5,
          },
        },
        // Add a new target
        targets: [
          ...baseConfig.targets,
          {
            name: 'background-job',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build:job',
            outputPath: './dist/job.js',
            watchPaths: ['src/jobs/**/*.ts'],
            settlingDelay: 1000,
          },
        ],
      };

      const detectChanges = (poltergeist as any).detectConfigChanges.bind(poltergeist);
      const changes = detectChanges(baseConfig, newConfig);

      // Verify all types of changes are detected
      expect(changes.watchmanChanged).toBe(true);
      expect(changes.notificationsChanged).toBe(true);
      expect(changes.buildSchedulingChanged).toBe(true);
      expect(changes.targetsAdded).toHaveLength(1);
      expect(changes.targetsAdded[0].name).toBe('background-job');
    });

    test('should detect deep nested configuration changes', async () => {
      const configPath = '/test/poltergeist.config.json';
      const poltergeist = new (await import('../src/poltergeist.js')).Poltergeist(
        baseConfig,
        '/test/project',
        harness.logger,
        harness.mocks,
        configPath
      );

      const configWithBuildScheduling = {
        ...baseConfig,
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

      const newConfig = {
        ...configWithBuildScheduling,
        buildScheduling: {
          ...configWithBuildScheduling.buildScheduling,
          prioritization: {
            ...configWithBuildScheduling.buildScheduling?.prioritization,
            focusDetectionWindow: 600000, // Only change this one value
          },
        },
      };

      const detectChanges = (poltergeist as any).detectConfigChanges.bind(poltergeist);
      const changes = detectChanges(configWithBuildScheduling, newConfig);

      expect(changes.buildSchedulingChanged).toBe(true);
    });
  });

  describe('Concurrent Operations and Race Conditions', () => {
    test('should handle rapid successive config changes', async () => {
      const configPath = '/test/poltergeist.config.json';
      const enhancedMocks = {
        ...harness.mocks,
        watchmanConfigManager: {
          ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
          suggestOptimizations: vi.fn().mockResolvedValue([]),
          normalizeWatchPattern: vi.fn().mockImplementation((pattern: string) => pattern),
          validateWatchPattern: vi.fn(),
          createExclusionExpressions: vi.fn().mockReturnValue([]),
        },
      };

      let loadConfigCallCount = 0;
      const { ConfigurationManager } = await import('../src/utils/config-manager.js');
      vi.spyOn(ConfigurationManager, 'loadConfigFromPath').mockImplementation(async () => {
        loadConfigCallCount++;
        // Simulate different configs for each call
        return {
          ...baseConfig,
          targets: [
            ...baseConfig.targets,
            {
              name: `dynamic-target-${loadConfigCallCount}`,
              type: 'executable',
              enabled: true,
              buildCommand: `npm run build:${loadConfigCallCount}`,
              outputPath: `./dist/target-${loadConfigCallCount}.js`,
              watchPaths: [`src/target${loadConfigCallCount}/**/*.ts`],
              settlingDelay: 1000,
            },
          ],
        };
      });

      const poltergeist = new (await import('../src/poltergeist.js')).Poltergeist(
        baseConfig,
        '/test/project',
        harness.logger,
        enhancedMocks,
        configPath
      );

      const handleConfigChange = (poltergeist as any).handleConfigChange.bind(poltergeist);

      // Simulate rapid successive config changes
      const changePromises = [
        handleConfigChange([{ name: 'poltergeist.config.json', exists: true }]),
        handleConfigChange([{ name: 'poltergeist.config.json', exists: true }]),
        handleConfigChange([{ name: 'poltergeist.config.json', exists: true }]),
      ];

      // All should complete without throwing
      await expect(Promise.all(changePromises)).resolves.not.toThrow();

      // Verify multiple reloads were triggered
      expect(loadConfigCallCount).toBe(3);

      const reloadLogs = harness.logger.info.mock.calls.filter((call) =>
        call[0].includes('Configuration file changed, reloading...')
      );
      expect(reloadLogs).toHaveLength(3);
    });

    test('should handle config changes during startup', async () => {
      const configPath = '/test/poltergeist.config.json';
      const enhancedMocks = {
        ...harness.mocks,
        watchmanConfigManager: {
          ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
          suggestOptimizations: vi.fn().mockResolvedValue([]),
          normalizeWatchPattern: vi.fn().mockImplementation((pattern: string) => pattern),
          validateWatchPattern: vi.fn(),
          createExclusionExpressions: vi.fn().mockReturnValue([]),
        },
      };

      let _configChangeCallback: Function | undefined;

      // Capture the callback and simulate immediate config change during startup
      enhancedMocks.watchmanClient!.subscribe = vi
        .fn()
        .mockImplementation((_projectRoot, subscriptionName, _subscription, callback) => {
          if (subscriptionName === 'poltergeist_config') {
            _configChangeCallback = callback;
            // Simulate immediate config change
            setTimeout(() => {
              callback([{ name: 'poltergeist.config.json', exists: true }]);
            }, 10);
          }
          return Promise.resolve();
        });

      const { ConfigurationManager } = await import('../src/utils/config-manager.js');
      vi.spyOn(ConfigurationManager, 'loadConfigFromPath').mockResolvedValue({
        ...baseConfig,
        targets: [
          ...baseConfig.targets,
          {
            name: 'startup-target',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build:startup',
            outputPath: './dist/startup.js',
            watchPaths: ['src/startup/**/*.ts'],
            settlingDelay: 1000,
          },
        ],
      });

      const poltergeist = new (await import('../src/poltergeist.js')).Poltergeist(
        baseConfig,
        '/test/project',
        harness.logger,
        enhancedMocks,
        configPath
      );

      // Start should complete successfully even with immediate config change
      await expect(poltergeist.start()).resolves.not.toThrow();

      // Give time for the config change to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify config reload was triggered
      expect(harness.logger.info).toHaveBeenCalledWith(
        '🔄 Configuration file changed, reloading...'
      );
    });
  });

  describe('Performance and Resource Management', () => {
    test('should not leak memory during repeated config reloads', async () => {
      const configPath = '/test/poltergeist.config.json';
      const enhancedMocks = {
        ...harness.mocks,
        watchmanConfigManager: {
          ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
          suggestOptimizations: vi.fn().mockResolvedValue([]),
          normalizeWatchPattern: vi.fn().mockImplementation((pattern: string) => pattern),
          validateWatchPattern: vi.fn(),
          createExclusionExpressions: vi.fn().mockReturnValue([]),
        },
      };

      const poltergeist = new (await import('../src/poltergeist.js')).Poltergeist(
        baseConfig,
        '/test/project',
        harness.logger,
        enhancedMocks,
        configPath
      );

      const { ConfigurationManager } = await import('../src/utils/config-manager.js');
      let configVersion = 0;

      vi.spyOn(ConfigurationManager, 'loadConfigFromPath').mockImplementation(async () => {
        configVersion++;
        return {
          ...baseConfig,
          targets: baseConfig.targets.map((target) => ({
            ...target,
            buildCommand: `${target.buildCommand}-v${configVersion}`,
          })),
        };
      });

      const handleConfigChange = (poltergeist as any).handleConfigChange.bind(poltergeist);

      // Perform many config reloads
      for (let i = 0; i < 10; i++) {
        await handleConfigChange([{ name: 'poltergeist.config.json', exists: true }]);
      }

      // Verify all reloads completed successfully
      const successLogs = harness.logger.info.mock.calls.filter((call) =>
        call[0].includes('Configuration reloaded successfully')
      );
      expect(successLogs).toHaveLength(10);

      // Verify no error accumulation
      expect(harness.logger.error).not.toHaveBeenCalled();
    });

    test('should handle large configuration files efficiently', async () => {
      const configPath = '/test/poltergeist.config.json';
      const enhancedMocks = {
        ...harness.mocks,
        watchmanConfigManager: {
          ensureConfigUpToDate: vi.fn().mockResolvedValue(undefined),
          suggestOptimizations: vi.fn().mockResolvedValue([]),
          normalizeWatchPattern: vi.fn().mockImplementation((pattern: string) => pattern),
          validateWatchPattern: vi.fn(),
          createExclusionExpressions: vi.fn().mockReturnValue([]),
        },
      };

      // Create a large config with many targets
      const largeTargets = Array.from({ length: 50 }, (_, i) => ({
        name: `target-${i}`,
        type: 'executable' as const,
        enabled: i % 3 === 0, // Only enable every 3rd target
        buildCommand: `npm run build:target-${i}`,
        outputPath: `./dist/target-${i}.js`,
        watchPaths: [`src/target-${i}/**/*.ts`],
        settlingDelay: 1000,
      }));

      const largeConfig: PoltergeistConfig = {
        ...baseConfig,
        targets: largeTargets,
      };

      const poltergeist = new (await import('../src/poltergeist.js')).Poltergeist(
        baseConfig,
        '/test/project',
        harness.logger,
        enhancedMocks,
        configPath
      );

      const detectChanges = (poltergeist as any).detectConfigChanges.bind(poltergeist);
      const applyChanges = (poltergeist as any).applyConfigChanges.bind(poltergeist);

      const startTime = Date.now();
      const changes = detectChanges(baseConfig, largeConfig);
      const detectionTime = Date.now() - startTime;

      // Change detection should be fast even for large configs
      expect(detectionTime).toBeLessThan(100); // Less than 100ms

      expect(changes.targetsAdded).toHaveLength(50);

      const applyStartTime = Date.now();
      await applyChanges(largeConfig, changes);
      const applyTime = Date.now() - applyStartTime;

      // Application should be reasonably fast
      expect(applyTime).toBeLessThan(1000); // Less than 1 second

      // Verify only enabled targets were created
      const createBuilderCalls = enhancedMocks.builderFactory.createBuilder.mock.calls;
      const enabledTargetCount = largeTargets.filter((t) => t.enabled).length;
      expect(createBuilderCalls).toHaveLength(enabledTargetCount);
    });
  });
});
