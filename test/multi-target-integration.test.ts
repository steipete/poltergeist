// Integration tests for multi-target scenarios
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Poltergeist } from '../src/poltergeist.js';
import { PoltergeistConfig } from '../src/types.js';
import { createPoltergeistWithDeps } from '../src/factories.js';
import { 
  createTestHarness, 
  simulateFileChange, 
  waitForAsync,
  expectBuilderCalledWith,
  TestHarness
} from './helpers.js';

// Mock child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn().mockReturnValue('abc123\n'),
}));

describe('Multi-Target Integration Tests', () => {
  let poltergeist: Poltergeist;
  let harness: TestHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Create test harness with multi-target config
    harness = createTestHarness({
      targets: [
        {
          name: 'backend',
          type: 'executable',
          enabled: true,
          buildCommand: 'npm run build:backend',
          outputPath: './dist/backend',
          watchPaths: ['backend/**/*.ts', 'shared/**/*.ts'],
          settlingDelay: 100,
        },
        {
          name: 'frontend',
          type: 'executable',
          enabled: true,
          buildCommand: 'npm run build:frontend',
          outputPath: './dist/frontend',
          watchPaths: ['frontend/**/*.tsx', 'shared/**/*.ts'],
          settlingDelay: 150,
        },
        {
          name: 'mac-app',
          type: 'app-bundle',
          enabled: true,
          buildCommand: 'xcodebuild -scheme MyApp',
          bundleId: 'com.example.app',
          platform: 'macos',
          watchPaths: ['mac-app/**/*.swift'],
          settlingDelay: 200,
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (poltergeist) {
      poltergeist['cleanup']();
    }
  });

  // Helper to start Poltergeist and clear initial build calls
  async function startAndClearBuilds() {
    await poltergeist.start();
    harness.builderFactory.builders.forEach(builder => vi.mocked(builder.build).mockClear());
  }

  describe('Target Independence', () => {
    it('should build targets independently', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      // Get all subscribe calls
      const subscribeCalls = vi.mocked(harness.watchmanClient.subscribe).mock.calls;
      
      // Find the subscription for backend files
      const backendSubIndex = subscribeCalls.findIndex(call => 
        call[2].expression[1] === 'backend/**/*.ts');
      expect(backendSubIndex).toBeGreaterThanOrEqual(0);
      
      // Trigger a change for the backend target only
      simulateFileChange(harness.watchmanClient, ['backend/server.ts'], backendSubIndex);

      // Backend has 100ms settling delay
      await waitForAsync(110);
      
      // Only backend should have built
      const backendBuilder = harness.builderFactory.builders.get('backend');
      const frontendBuilder = harness.builderFactory.builders.get('frontend');
      const macAppBuilder = harness.builderFactory.builders.get('mac-app');
      
      expect(backendBuilder?.build).toHaveBeenCalledTimes(1);
      expect(frontendBuilder?.build).not.toHaveBeenCalled();
      expect(macAppBuilder?.build).not.toHaveBeenCalled();
      
      // Now trigger frontend change
      const frontendSubIndex = subscribeCalls.findIndex(call => 
        call[2].expression[1] === 'frontend/**/*.tsx');
      expect(frontendSubIndex).toBeGreaterThanOrEqual(0);
      
      simulateFileChange(harness.watchmanClient, ['frontend/App.tsx'], frontendSubIndex);
      
      // Frontend has 150ms settling delay
      await waitForAsync(160);
      
      // Now frontend should have built too
      expect(frontendBuilder?.build).toHaveBeenCalledTimes(1);
      expect(macAppBuilder?.build).not.toHaveBeenCalled();
    });

    it('should handle failures in one target without affecting others', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      // Make backend fail after initialization
      const backendBuilder = harness.builderFactory.builders.get('backend');
      vi.mocked(backendBuilder!.build).mockResolvedValue({
        status: 'failure',
        targetName: 'backend',
        timestamp: new Date().toISOString(),
        error: 'Build failed',
      });

      // Get callbacks
      const backendCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0]?.[3];
      const frontendCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[1]?.[3];

      // Trigger changes for both
      backendCallback([{ name: 'backend/server.ts', exists: true, type: 'f' }]);
      frontendCallback([{ name: 'frontend/App.tsx', exists: true, type: 'f' }]);

      // Wait for builds
      vi.advanceTimersByTime(160);

      // Both should have attempted to build
      expect(harness.builderFactory.builders.get('backend')?.build).toHaveBeenCalled();
      expect(harness.builderFactory.builders.get('frontend')?.build).toHaveBeenCalled();

      // Frontend should succeed despite backend failure
      const frontendResult = await harness.builderFactory.builders.get('frontend')?.build.mock.results[0].value;
      expect(frontendResult.status).toBe('success');
    });
  });

  describe('Shared Dependencies', () => {
    it('should rebuild dependent targets when shared files change', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      // Get callbacks for backend and frontend (both watch shared/)
      const backendCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0]?.[3];
      const frontendCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[1]?.[3];

      // Change a shared file
      const sharedChange = { name: 'shared/types.ts', exists: true, type: 'f' };
      backendCallback([sharedChange]);
      frontendCallback([sharedChange]);

      // Wait for builds
      vi.advanceTimersByTime(160);

      // Both targets should rebuild
      expect(harness.builderFactory.builders.get('backend')?.build).toHaveBeenCalledWith(['shared/types.ts']);
      expect(harness.builderFactory.builders.get('frontend')?.build).toHaveBeenCalledWith(['shared/types.ts']);
    });

    it('should deduplicate builds when same file triggers multiple targets', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      const backendCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0]?.[3];
      const frontendCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[1]?.[3];

      // Same file change reported multiple times
      const sharedChange = { name: 'shared/utils.ts', exists: true, type: 'f' };
      
      // Simulate watchman reporting the change to both subscriptions multiple times
      backendCallback([sharedChange]);
      backendCallback([sharedChange]); // Duplicate
      frontendCallback([sharedChange]);
      frontendCallback([sharedChange]); // Duplicate

      // Wait for builds
      vi.advanceTimersByTime(160);

      // Each target should only build once
      expect(harness.builderFactory.builders.get('backend')?.build).toHaveBeenCalledTimes(1);
      expect(harness.builderFactory.builders.get('frontend')?.build).toHaveBeenCalledTimes(1);
    });
  });

  describe('Target Enable/Disable', () => {
    it('should only build enabled targets', async () => {
      harness.config.targets[1].enabled = false; // Disable frontend

      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      // Should create subscriptions for watch paths of enabled targets
      // backend: backend/**/*.ts and shared/**/*.ts = 2 subscriptions
      // mac-app: mac-app/**/*.swift = 1 subscription
      // Total: 3 subscriptions
      expect(harness.watchmanClient.subscribe).toHaveBeenCalledTimes(3);

      // Verify builders created only for enabled targets
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledTimes(2);
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'backend' }),
        expect.any(String),
        expect.any(Object),
        expect.any(Object)
      );
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'mac-app' }),
        expect.any(String),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should handle starting specific target only', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await poltergeist.start('frontend');

      // Should create subscriptions for the specified target's watch paths
      // frontend has 2 watch paths: frontend/**/*.tsx and shared/**/*.ts
      expect(harness.watchmanClient.subscribe).toHaveBeenCalledTimes(2);

      // Should only create builder for specified target
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledTimes(1);
      expect(harness.builderFactory.createBuilder).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'frontend' }),
        expect.any(String),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('Resource Management', () => {
    it('should manage resources efficiently with many targets', async () => {
      // Add more targets
      const manyTargets = Array.from({ length: 10 }, (_, i) => ({
        name: `service-${i}`,
        type: 'executable' as const,
        enabled: true,
        buildCommand: `npm run build:service${i}`,
        outputPath: `./dist/service${i}`,
        watchPaths: [`services/service${i}/**/*`],
      }));

      harness.config.targets.push(...manyTargets);

      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      // Should create subscriptions for all unique watch paths
      // backend: backend/**/*.ts, shared/**/*.ts
      // frontend: frontend/**/*.tsx, shared/**/*.ts (shared is deduplicated)
      // mac-app: mac-app/**/*.swift
      // service0-9: 10 unique paths
      // Total: 14 unique paths
      expect(harness.watchmanClient.subscribe).toHaveBeenCalledTimes(14);

      // Stop specific target
      await poltergeist.stop('service-5');

      // Should stop the builder for that target
      expect(harness.builderFactory.builders.get('service-5')?.stop).toHaveBeenCalled();
      
      // Should not unsubscribe from Watchman (subscriptions are shared)
      expect(harness.watchmanClient.unsubscribe).not.toHaveBeenCalled();

      // Other targets should remain active
      expect(harness.builderFactory.builders.get('service-4')?.stop).not.toHaveBeenCalled();
    });

    it.skip('should clean up all resources on full stop', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      // Stop all
      await poltergeist.stop();

      // Should disconnect watchman
      expect(harness.watchmanClient.disconnect).toHaveBeenCalled();

      // Should clean up state
      const stateManager = harness.deps.stateManager;
      expect(stateManager.cleanup).toHaveBeenCalled();

      // Should clear all builders
      const targetBuilders = (poltergeist as any).targetBuilders;
      expect(targetBuilders.size).toBe(0);
    });
  });

  describe('Build Coordination', () => {
    it.skip('should handle concurrent builds across targets', async () => {
      // Make builds take time
      let buildResolvers: Map<string, () => void> = new Map();
      
      mockBuilders.forEach((builder, name) => {
        builder.build.mockImplementation(() => 
          new Promise(resolve => {
            buildResolvers.set(name, () => resolve({
              status: 'success',
              targetName: name,
              timestamp: new Date().toISOString(),
              duration: 500,
            }));
          })
        );
      });

      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      // Trigger all targets simultaneously
      const callbacks = [
        vi.mocked(harness.watchmanClient.subscribe).mock.calls[0]?.[3],
        vi.mocked(harness.watchmanClient.subscribe).mock.calls[1]?.[3],
        vi.mocked(harness.watchmanClient.subscribe).mock.calls[2]?.[3],
      ];

      callbacks[0]([{ name: 'backend/index.ts', exists: true, type: 'f' }]);
      callbacks[1]([{ name: 'frontend/index.tsx', exists: true, type: 'f' }]);
      callbacks[2]([{ name: 'mac-app/main.swift', exists: true, type: 'f' }]);

      // Advance time to trigger all builds
      vi.advanceTimersByTime(210);
      
      // Wait for async operations
      await vi.runAllTimersAsync();

      // All should be building
      expect(harness.builderFactory.builders.get('backend')?.build).toHaveBeenCalled();
      expect(harness.builderFactory.builders.get('frontend')?.build).toHaveBeenCalled();
      expect(harness.builderFactory.builders.get('mac-app')?.build).toHaveBeenCalled();

      // Complete builds in different order
      buildResolvers.get('frontend')!();
      await Promise.resolve();
      
      buildResolvers.get('backend')!();
      await Promise.resolve();
      
      buildResolvers.get('mac-app')!();
      await Promise.resolve();

      // All should complete successfully
      const stateManager = harness.deps.stateManager;
      expect(stateManager.updateBuildStatus).toHaveBeenCalledTimes(6); // 3 building + 3 success
    });

    it('should queue builds per target independently', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      const backendCallback = vi.mocked(harness.watchmanClient.subscribe).mock.calls[0]?.[3];

      // Make backend build slow
      let buildComplete: () => void;
      vi.mocked(harness.builderFactory.builders.get('backend')!.build).mockImplementationOnce(() => 
        new Promise(resolve => {
          buildComplete = () => resolve({
            status: 'success',
            targetName: 'backend',
            timestamp: new Date().toISOString(),
            duration: 1000,
          });
        })
      );

      // First change triggers build
      backendCallback([{ name: 'backend/file1.ts', exists: true, type: 'f' }]);
      vi.advanceTimersByTime(110);

      // More changes while building
      backendCallback([{ name: 'backend/file2.ts', exists: true, type: 'f' }]);
      backendCallback([{ name: 'backend/file3.ts', exists: true, type: 'f' }]);

      // Complete first build
      buildComplete!();
      await Promise.resolve();

      // Wait for second build
      vi.advanceTimersByTime(110);

      // Should have queued and run second build
      expect(harness.builderFactory.builders.get('backend')?.build).toHaveBeenCalledTimes(2);
      expect(harness.builderFactory.builders.get('backend')?.build).toHaveBeenLastCalledWith([
        'backend/file2.ts',
        'backend/file3.ts',
      ]);
    });
  });

  describe('Status Reporting', () => {
    it.skip('should report accurate status for all targets', async () => {
      // Configure state manager to return different states
      vi.mocked(harness.deps.stateManager.readState).mockImplementation((target) => {
        if (target === 'backend') {
          return Promise.resolve({
            version: '1.0',
            projectPath: '/test/project',
            projectName: 'test',
            target: 'backend',
            targetType: 'executable',
            configPath: '/test/project/.poltergeist.json',
            process: { 
              pid: 1234, 
              hostname: 'test-host',
              isActive: true,
              startTime: new Date().toISOString(),
              lastHeartbeat: new Date().toISOString()
            },
            lastBuild: {
              status: 'success',
              targetName: 'backend',
              timestamp: new Date().toISOString(),
            },
          });
        } else if (target === 'frontend') {
          return Promise.resolve({
            version: '1.0',
            projectPath: '/test/project',
            projectName: 'test',
            target: 'frontend',
            targetType: 'executable',
            configPath: '/test/project/.poltergeist.json',
            process: { 
              pid: 1234, 
              hostname: 'test-host',
              isActive: true,
              startTime: new Date().toISOString(),
              lastHeartbeat: new Date().toISOString()
            },
            lastBuild: {
              status: 'failure',
              targetName: 'frontend',
              timestamp: new Date().toISOString(),
              error: 'Build failed',
            },
          });
        }
        return Promise.resolve(null);
      });

      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      const status = await poltergeist.getStatus();

      expect(status).toHaveProperty('backend');
      expect(status).toHaveProperty('frontend');
      expect(status).toHaveProperty('mac-app');

      expect(status.backend.lastBuild?.status).toBe('success');
      expect(status.frontend.lastBuild?.status).toBe('failure');
      expect(status['mac-app'].status).toBe('not running'); // No state file
    });

    it('should report status for specific target', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      const status = await poltergeist.getStatus('frontend');

      expect(status).toHaveProperty('frontend');
      expect(Object.keys(status)).toHaveLength(1);
    });
  });

  describe('Error Scenarios', () => {
    it.skip('should handle watchman errors affecting all targets', async () => {
      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      await startAndClearBuilds();

      // Simulate watchman crash
      harness.watchmanClient.emit('disconnected');

      // Should log error
      expect(harness.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Watchman connection lost')
      );

      // Should still be able to get status (degraded)
      const status = await poltergeist.getStatus();
      expect(status).toBeDefined();
    });

    it.skip('should handle invalid target configurations', async () => {
      harness.config.targets.push({
        name: 'invalid',
        type: 'unknown-type' as any,
        enabled: true,
        buildCommand: 'echo test',
        watchPaths: ['**/*'],
      } as any);

      poltergeist = createPoltergeistWithDeps(harness.config, '/test/project', harness.deps, harness.logger);
      
      // Should start successfully, skipping invalid target
      await expect(poltergeist.start()).resolves.not.toThrow();

      // Should log error about invalid target
      expect(harness.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create builder'),
        expect.any(Error)
      );

      // Valid targets should still work
      expect(harness.watchmanClient.subscribe).toHaveBeenCalledTimes(3); // Only valid targets
    });
  });
});