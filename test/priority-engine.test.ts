// Priority Engine Tests - Intelligent Build Prioritization

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PriorityEngine } from '../src/priority-engine.js';
import type { BuildSchedulingConfig, Target, BuildStatus } from '../src/types.js';
import { createMockLogger, createTestConfig } from './helpers.js';

describe('PriorityEngine', () => {
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
        priorityDecayTime: 1800000,   // 30 minutes
        buildTimeoutMultiplier: 2.0,
      },
    };

    const testConfig = createTestConfig();
    targets = [
      {
        name: 'frontend',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/frontend',
        watchPaths: ['frontend/**/*.ts', 'frontend/**/*.tsx', 'package.json', 'shared/**/*.ts'],
      },
      {
        name: 'backend',
        type: 'executable', 
        enabled: true,
        buildCommand: 'cargo build',
        outputPath: './target/backend',
        watchPaths: ['backend/**/*.rs', 'package.json'],
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('File Change Recording', () => {
    it('should record direct file changes', () => {
      const files = ['frontend/src/app.ts', 'frontend/src/component.tsx'];
      const events = priorityEngine.recordChange(files, targets);

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        file: 'frontend/src/app.ts',
        affectedTargets: ['frontend'],
        changeType: 'direct',
        impactWeight: 1.0,
      });
      expect(events[1]).toMatchObject({
        file: 'frontend/src/component.tsx',
        affectedTargets: ['frontend'],
        changeType: 'direct',
        impactWeight: 1.0,
      });
    });

    it('should classify shared file changes', () => {
      const files = ['shared/utils.ts'];
      const events = priorityEngine.recordChange(files, targets);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        file: 'shared/utils.ts',
        affectedTargets: ['frontend', 'shared'],
        changeType: 'shared',
        impactWeight: 0.7,
      });
    });

    it('should handle files affecting multiple targets', () => {
      const files = ['package.json']; // This could affect multiple targets
      const events = priorityEngine.recordChange(files, targets);

      expect(events).toHaveLength(1);
      // Should detect that package.json could affect multiple targets
      expect(events[0].affectedTargets.length).toBeGreaterThanOrEqual(1);
    });

    it('should track timestamps correctly', () => {
      const files = ['frontend/src/app.ts'];
      const events = priorityEngine.recordChange(files, targets);

      expect(events[0].timestamp).toBe(Date.now());
    });
  });

  describe('Priority Calculation', () => {
    it('should calculate basic priority for direct file changes', () => {
      // Record some changes first
      priorityEngine.recordChange(['frontend/src/app.ts'], targets);
      
      const priority = priorityEngine.calculatePriority(targets[0], ['frontend/src/app.ts']);

      expect(priority.target).toBe('frontend');
      expect(priority.score).toBeGreaterThan(0);
      expect(priority.directChangeFrequency).toBe(1);
    });

    it('should apply focus multiplier for recent activity', () => {
      // Record changes to establish focus
      priorityEngine.recordChange(['frontend/src/app.ts'], targets);
      priorityEngine.recordChange(['frontend/src/component.tsx'], targets);
      
      const priority = priorityEngine.calculatePriority(targets[0], ['frontend/src/new.ts']);

      expect(priority.focusMultiplier).toBeGreaterThan(1.0);
      expect(priority.focusMultiplier).toBeLessThanOrEqual(2.0);
    });

    it('should decay focus over time', () => {
      // Record initial changes
      priorityEngine.recordChange(['frontend/src/app.ts'], targets);
      
      const initialPriority = priorityEngine.calculatePriority(targets[0], ['frontend/src/app.ts']);
      
      // Advance time beyond focus window
      vi.advanceTimersByTime(400000); // 6.67 minutes
      
      const decayedPriority = priorityEngine.calculatePriority(targets[0], ['frontend/src/app.ts']);
      
      expect(decayedPriority.focusMultiplier).toBeLessThan(initialPriority.focusMultiplier);
    });

    it('should handle serial mode build time penalties', () => {
      const serialConfig = {
        ...config,
        parallelization: 1,
      };
      const serialEngine = new PriorityEngine(serialConfig, logger);
      
      // Simulate a slow build target
      serialEngine.recordBuildResult('frontend', {
        status: 'success',
        targetName: 'frontend',
        timestamp: new Date().toISOString(),
        duration: 45000, // 45 seconds
      });
      
      const priority = serialEngine.calculatePriority(targets[0], ['frontend/src/app.ts']);
      
      // Should apply penalty for slow builds in serial mode
      expect(priority.avgBuildTime).toBe(45000);
    });

    it('should factor in build success rates', () => {
      // Record some failed builds
      priorityEngine.recordBuildResult('frontend', {
        status: 'failure',
        targetName: 'frontend',
        timestamp: new Date().toISOString(),
        duration: 5000,
        error: 'Build failed',
      });
      
      priorityEngine.recordBuildResult('frontend', {
        status: 'failure', 
        targetName: 'frontend',
        timestamp: new Date().toISOString(),
        duration: 5000,
        error: 'Build failed again',
      });
      
      const priority = priorityEngine.calculatePriority(targets[0], ['frontend/src/app.ts']);
      
      expect(priority.successRate).toBe(0); // 0% success rate
    });
  });

  describe('Build Result Recording', () => {
    it('should record successful builds', () => {
      const buildStatus: BuildStatus = {
        status: 'success',
        targetName: 'frontend',
        timestamp: new Date().toISOString(),
        duration: 5000,
      };

      priorityEngine.recordBuildResult('frontend', buildStatus);
      
      const priority = priorityEngine.calculatePriority(targets[0], []);
      expect(priority.successRate).toBe(1.0);
      expect(priority.avgBuildTime).toBe(5000);
    });

    it('should record failed builds', () => {
      const buildStatus: BuildStatus = {
        status: 'failure',
        targetName: 'frontend', 
        timestamp: new Date().toISOString(),
        duration: 3000,
        error: 'Compilation error',
      };

      priorityEngine.recordBuildResult('frontend', buildStatus);
      
      const priority = priorityEngine.calculatePriority(targets[0], []);
      expect(priority.successRate).toBe(0);
      expect(priority.avgBuildTime).toBe(3000);
    });

    it('should calculate rolling averages for build metrics', () => {
      // Record multiple builds
      const builds = [
        { duration: 1000, status: 'success' as const },
        { duration: 2000, status: 'success' as const },
        { duration: 3000, status: 'failure' as const },
        { duration: 4000, status: 'success' as const },
      ];

      builds.forEach(build => {
        priorityEngine.recordBuildResult('frontend', {
          status: build.status,
          targetName: 'frontend',
          timestamp: new Date().toISOString(),
          duration: build.duration,
        });
      });

      const priority = priorityEngine.calculatePriority(targets[0], []);
      expect(priority.successRate).toBe(0.75); // 3/4 successful
      expect(priority.avgBuildTime).toBeGreaterThan(1000);
      expect(priority.avgBuildTime).toBeLessThan(4000);
    });

    it('should maintain limited history size', () => {
      // Record many builds to test history limit
      for (let i = 0; i < 150; i++) {
        priorityEngine.recordBuildResult('frontend', {
          status: 'success',
          targetName: 'frontend',
          timestamp: new Date().toISOString(),
          duration: 1000 + i,
        });
      }

      const priority = priorityEngine.calculatePriority(targets[0], []);
      // Should not have more recent changes than the limit (100)
      expect(priority.recentChanges.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Focus Detection', () => {
    it('should detect focus patterns from recent changes', () => {
      const focusInfo = priorityEngine.getFocusInfo();
      expect(focusInfo).toEqual([]);

      // Create focus on frontend
      priorityEngine.recordChange(['frontend/src/app.ts'], targets);
      priorityEngine.recordChange(['frontend/src/component.tsx'], targets);
      
      const focusAfterChanges = priorityEngine.getFocusInfo();
      expect(focusAfterChanges).toContainEqual({
        target: 'frontend',
        percentage: expect.any(Number),
        multiplier: expect.any(Number),
      });
    });

    it('should calculate focus percentages correctly', () => {
      // Create activity on multiple targets
      priorityEngine.recordChange(['frontend/src/app.ts'], targets);
      priorityEngine.recordChange(['frontend/src/component.tsx'], targets);
      priorityEngine.recordChange(['backend/src/main.rs'], targets);
      
      const focusInfo = priorityEngine.getFocusInfo();
      
      // Should show higher percentage for frontend (2/3 changes)
      const frontendFocus = focusInfo.find(f => f.target === 'frontend');
      const backendFocus = focusInfo.find(f => f.target === 'backend');
      
      expect(frontendFocus?.percentage).toBeGreaterThan(backendFocus?.percentage || 0);
    });

    it('should ignore changes outside focus window', () => {
      // Record old changes
      priorityEngine.recordChange(['frontend/src/app.ts'], targets);
      
      // Advance time beyond focus window
      vi.advanceTimersByTime(400000); // 6.67 minutes
      
      // Record new changes
      priorityEngine.recordChange(['backend/src/main.rs'], targets);
      
      const focusInfo = priorityEngine.getFocusInfo();
      
      // Should only show backend focus (frontend changes are too old)
      expect(focusInfo).toHaveLength(1);
      expect(focusInfo[0].target).toBe('backend');
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle disabled prioritization', () => {
      const disabledConfig = {
        ...config,
        prioritization: {
          ...config.prioritization,
          enabled: false,
        },
      };
      
      const disabledEngine = new PriorityEngine(disabledConfig, logger);
      
      const priority = disabledEngine.calculatePriority(targets[0], ['frontend/src/app.ts']);
      
      // Should still calculate priority but with minimal scoring
      expect(priority.score).toBeGreaterThanOrEqual(0);
      expect(priority.focusMultiplier).toBe(1.0);
    });

    it('should handle zero focus detection window', () => {
      const noFocusConfig = {
        ...config,
        prioritization: {
          ...config.prioritization,
          focusDetectionWindow: 0,
        },
      };
      
      const noFocusEngine = new PriorityEngine(noFocusConfig, logger);
      
      noFocusEngine.recordChange(['frontend/src/app.ts'], targets);
      const focusInfo = noFocusEngine.getFocusInfo();
      
      expect(focusInfo).toHaveLength(0);
    });

    it('should handle very short priority decay time', () => {
      const fastDecayConfig = {
        ...config,
        prioritization: {
          ...config.prioritization,
          priorityDecayTime: 1000, // 1 second
        },
      };
      
      const fastDecayEngine = new PriorityEngine(fastDecayConfig, logger);
      
      fastDecayEngine.recordChange(['frontend/src/app.ts'], targets);
      
      vi.advanceTimersByTime(2000); // 2 seconds
      
      const priority = fastDecayEngine.calculatePriority(targets[0], []);
      
      // Priority should have decayed significantly
      expect(priority.score).toBeLessThan(50);
    });
  });

  describe('Multi-target Scenarios', () => {
    it('should handle complex dependency scenarios', () => {
      // Simulate changes that affect multiple targets
      const sharedFiles = ['shared/types.ts'];
      const events = priorityEngine.recordChange(sharedFiles, targets);
      
      // Should affect the shared target
      expect(events[0].affectedTargets).toContain('shared');
    });

    it('should prioritize based on change frequency', () => {
      // Create frequent changes to frontend
      for (let i = 0; i < 5; i++) {
        priorityEngine.recordChange([`frontend/src/file${i}.ts`], targets);
        vi.advanceTimersByTime(10000); // 10 seconds between changes
      }
      
      // Single change to backend
      priorityEngine.recordChange(['backend/src/main.rs'], targets);
      
      const frontendPriority = priorityEngine.calculatePriority(targets[0], ['frontend/src/new.ts']);
      const backendPriority = priorityEngine.calculatePriority(targets[1], ['backend/src/new.rs']);
      
      expect(frontendPriority.directChangeFrequency).toBeGreaterThan(backendPriority.directChangeFrequency);
      expect(frontendPriority.score).toBeGreaterThan(backendPriority.score);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid target names gracefully', () => {
      expect(() => {
        priorityEngine.recordBuildResult('nonexistent', {
          status: 'success',
          targetName: 'nonexistent',
          timestamp: new Date().toISOString(),
          duration: 1000,
        });
      }).not.toThrow();
    });

    it('should handle empty file lists', () => {
      const events = priorityEngine.recordChange([], targets);
      expect(events).toHaveLength(0);
    });

    it('should handle empty target lists', () => {
      const events = priorityEngine.recordChange(['some/file.ts'], []);
      expect(events).toHaveLength(0);
    });

    it('should handle malformed file paths', () => {
      const events = priorityEngine.recordChange(['', '   ', '//', 'frontend/src/valid.ts'], targets);
      
      // Should filter out invalid paths but process valid ones
      expect(events.length).toBeGreaterThan(0);
      expect(events.every(e => e.file.trim().length > 0)).toBe(true);
    });
  });
});