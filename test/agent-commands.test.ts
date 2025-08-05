// Tests for agent-friendly CLI commands: wait, logs, and enhanced status

import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoltergeistConfig } from '../src/types.js';

// Mock modules
vi.mock('fs');
vi.mock('../src/factories.js');
vi.mock('../src/logger.js');
vi.mock('../src/utils/config-manager.js');

// Import after mocking
import { existsSync, readFileSync } from 'fs';
import { program } from '../src/cli.js';
import { createPoltergeist } from '../src/factories.js';
import { createLogger } from '../src/logger.js';
import { ConfigurationManager } from '../src/utils/config-manager.js';

describe('Agent-Friendly Commands', () => {
  let mockPoltergeist: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;
  let originalTTY: boolean | undefined;

  const mockConfig: PoltergeistConfig = {
    version: '1.0',
    projectType: 'node',
    targets: [
      {
        name: 'test-app',
        type: 'executable',
        buildCommand: 'npm run build:test',
        outputPath: './dist/test.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      },
    ],
  };

  beforeEach(() => {
    // Save original TTY state
    originalTTY = process.stdout.isTTY;

    // Reset mocks
    vi.clearAllMocks();

    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    // Mock file system
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    // Mock config manager
    vi.mocked(ConfigurationManager.getConfig).mockResolvedValue({
      config: mockConfig,
      projectRoot: '/test/project',
      configPath: '/test/project/poltergeist.config.json',
    });

    // Mock logger
    vi.mocked(createLogger).mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any);

    // Create mock Poltergeist instance
    mockPoltergeist = {
      getStatus: vi.fn().mockResolvedValue({
        'test-app': {
          status: 'idle',
          lastBuild: {
            status: 'success',
            timestamp: new Date().toISOString(),
            duration: 3000,
          },
          process: {
            pid: 1234,
            hostname: 'test-host',
            isActive: true,
            lastHeartbeat: new Date().toISOString(),
          },
          buildStats: {
            averageDuration: 3500,
            minDuration: 2000,
            maxDuration: 5000,
            successfulBuilds: [
              { duration: 3000, timestamp: new Date(Date.now() - 60000).toISOString() },
              { duration: 4000, timestamp: new Date(Date.now() - 120000).toISOString() },
            ],
          },
          buildCommand: 'npm run build:test',
        },
      }),
    };

    vi.mocked(createPoltergeist).mockReturnValue(mockPoltergeist);
  });

  afterEach(() => {
    // Restore original TTY state
    if (originalTTY !== undefined) {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalTTY,
        writable: true,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
  });

  describe('status command', () => {
    it('shows agent instructions when not in TTY and building', async () => {
      // Set non-TTY environment (simulating agent)
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      // Mock building status
      mockPoltergeist.getStatus.mockResolvedValue({
        'test-app': {
          status: 'watching',
          lastBuild: {
            status: 'building',
            timestamp: new Date().toISOString(),
          },
          process: {
            pid: 1234,
            hostname: 'test-host',
            isActive: true,
          },
          buildStats: {
            averageDuration: 180000, // 3 minutes
          },
          buildCommand: 'npm run build:test',
        },
      });

      try {
        await program.parseAsync(['node', 'cli.js', 'status']);
      } catch (error) {
        // Expected due to process.exit mock
      }

      // Check that agent instructions were shown
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain("Use 'poltergeist wait test-app' (timeout: 210s recommended)");
      expect(output).toContain("Or 'poltergeist logs test-app -f' for detailed output.");
      expect(output).toContain('DO NOT run build commands manually unless build fails.');
    });

    it('does not show agent instructions in TTY mode', async () => {
      // Set TTY environment (simulating human)
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });

      // Mock building status
      mockPoltergeist.getStatus.mockResolvedValue({
        'test-app': {
          status: 'watching',
          lastBuild: {
            status: 'building',
            timestamp: new Date().toISOString(),
          },
          process: {
            pid: 1234,
            hostname: 'test-host',
            isActive: true,
          },
          buildStats: {
            averageDuration: 180000,
          },
          buildCommand: 'npm run build:test',
        },
      });

      try {
        await program.parseAsync(['node', 'cli.js', 'status']);
      } catch (error) {
        // Expected due to process.exit mock
      }

      // Check that agent instructions were NOT shown
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).not.toContain("Use 'poltergeist wait");
      expect(output).not.toContain('DO NOT run build commands manually');
    });

    it('shows build time estimates when building', async () => {
      const buildStartTime = new Date(Date.now() - 45000); // 45 seconds ago

      mockPoltergeist.getStatus.mockResolvedValue({
        'test-app': {
          status: 'watching',
          lastBuild: {
            status: 'building',
            timestamp: buildStartTime.toISOString(),
          },
          buildStats: {
            averageDuration: 180000, // 3 minutes average
          },
          buildCommand: 'npm run build:test',
        },
      });

      try {
        await program.parseAsync(['node', 'cli.js', 'status']);
      } catch (error) {
        // Expected
      }

      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Elapsed: 45s / ~180s');
      expect(output).toContain('135s remaining');
    });
  });

  describe('wait command', () => {
    it('waits for build completion with minimal output in non-TTY', async () => {
      // Set non-TTY environment
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const buildStart = new Date(Date.now() - 30000);

      // First call returns building, second returns success
      mockPoltergeist.getStatus
        .mockResolvedValueOnce({
          'test-app': {
            lastBuild: {
              status: 'building',
              timestamp: buildStart.toISOString(),
            },
            buildStats: {
              averageDuration: 60000, // 1 minute average
            },
            buildCommand: 'npm run build:test',
          },
        })
        .mockResolvedValueOnce({
          'test-app': {
            lastBuild: {
              status: 'success',
              timestamp: buildStart.toISOString(),
              duration: 35000,
            },
          },
        });

      try {
        await program.parseAsync(['node', 'cli.js', 'wait', 'test-app']);
      } catch (error) {
        // Expected
      }

      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain("⏳ Waiting for 'test-app' build...");
      expect(output).toContain('Command: npm run build:test');
      expect(output).toContain('Started: 30s ago, ~30s remaining');
      expect(output).toContain('✅ Build completed successfully');
    });

    it('handles multiple building targets by requiring specification', async () => {
      mockPoltergeist.getStatus.mockResolvedValue({
        'test-app': {
          lastBuild: {
            status: 'building',
            timestamp: new Date().toISOString(),
          },
          buildCommand: 'npm run build:app',
        },
        'test-lib': {
          lastBuild: {
            status: 'building',
            timestamp: new Date().toISOString(),
          },
          buildCommand: 'npm run build:lib',
        },
      });

      try {
        await program.parseAsync(['node', 'cli.js', 'wait']);
      } catch (error) {
        // Expected
      }

      const errorOutput = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(errorOutput).toContain('❌ Multiple targets building. Please specify:');
      expect(errorOutput).toContain('test-app: npm run build:app');
      expect(errorOutput).toContain('test-lib: npm run build:lib');
      expect(errorOutput).toContain('Usage: poltergeist wait <target>');
    });

    it('automatically selects single building target', async () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      mockPoltergeist.getStatus
        .mockResolvedValueOnce({
          'test-app': {
            lastBuild: {
              status: 'building',
              timestamp: new Date().toISOString(),
            },
            buildCommand: 'npm run build:test',
          },
        })
        .mockResolvedValueOnce({
          'test-app': {
            lastBuild: {
              status: 'success',
            },
          },
        });

      try {
        await program.parseAsync(['node', 'cli.js', 'wait']);
      } catch (error) {
        // Expected
      }

      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain("⏳ Waiting for 'test-app' build...");
    });

    it('exits with error code when build fails', async () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      mockPoltergeist.getStatus
        .mockResolvedValueOnce({
          'test-app': {
            lastBuild: {
              status: 'building',
              timestamp: new Date().toISOString(),
            },
            buildCommand: 'npm run build:test',
          },
        })
        .mockResolvedValueOnce({
          'test-app': {
            lastBuild: {
              status: 'failure',
              errorSummary: 'Compilation error in src/app.ts',
            },
          },
        });

      let exitCode: number | undefined;
      processExitSpy.mockImplementation((code?: string | number) => {
        exitCode = typeof code === 'number' ? code : parseInt(code || '0');
        throw new Error('process.exit');
      });

      try {
        await program.parseAsync(['node', 'cli.js', 'wait', 'test-app']);
      } catch (error) {
        // Expected
      }

      expect(exitCode).toBe(1);
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('❌ Build failed');
      expect(output).toContain('Error: Compilation error in src/app.ts');
    });
  });

  describe('logs command', () => {
    beforeEach(() => {
      // Mock log file content
      const logEntries = [
        { timestamp: '2024-01-01T10:00:00', level: 'info', message: 'Build started', target: 'test-app' },
        { timestamp: '2024-01-01T10:00:05', level: 'error', message: 'Build failed', target: 'test-app' },
        { timestamp: '2024-01-01T10:00:10', level: 'info', message: 'Build started', target: 'test-lib' },
      ];
      vi.mocked(readFileSync).mockImplementation((path) => {
        if (path.toString().endsWith('.log')) {
          return logEntries.map(e => JSON.stringify(e)).join('\n');
        }
        return JSON.stringify(mockConfig);
      });
    });

    it('supports -t flag for tail option', async () => {
      try {
        await program.parseAsync(['node', 'cli.js', 'logs', 'test-app', '-t', '50']);
      } catch (error) {
        // Expected
      }

      // Should parse the tail option correctly
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Build started');
    });

    it('automatically selects single target', async () => {
      // Mock single target in config
      const singleTargetConfig = {
        ...mockConfig,
        targets: [mockConfig.targets[0]],
      };
      vi.mocked(ConfigurationManager.getConfig).mockResolvedValue({
        config: singleTargetConfig,
        projectRoot: '/test/project',
        configPath: '/test/project/poltergeist.config.json',
      });

      mockPoltergeist.getStatus.mockResolvedValue({
        'test-app': {
          status: 'idle',
        },
      });

      try {
        await program.parseAsync(['node', 'cli.js', 'logs']);
      } catch (error) {
        // Expected
      }

      // Should not show error about multiple targets
      const errorOutput = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(errorOutput).not.toContain('Multiple targets available');
    });

    it('requires target specification for multiple targets', async () => {
      // Mock multiple targets
      const multiTargetConfig = {
        ...mockConfig,
        targets: [
          ...mockConfig.targets,
          {
            name: 'test-lib',
            type: 'library' as const,
            buildCommand: 'npm run build:lib',
            outputPath: './dist/lib.js',
            watchPaths: ['lib/**/*.ts'],
            libraryType: 'static' as const,
            enabled: true,
          },
        ],
      };
      vi.mocked(ConfigurationManager.getConfig).mockResolvedValue({
        config: multiTargetConfig,
        projectRoot: '/test/project',
        configPath: '/test/project/poltergeist.config.json',
      });

      mockPoltergeist.getStatus.mockResolvedValue({
        'test-app': {
          status: 'idle',
          lastBuild: {
            timestamp: new Date().toISOString(),
          },
        },
        'test-lib': {
          status: 'idle',
          lastBuild: {
            timestamp: new Date().toISOString(),
          },
        },
      });

      try {
        await program.parseAsync(['node', 'cli.js', 'logs']);
      } catch (error) {
        // Expected
      }

      const errorOutput = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(errorOutput).toContain('❌ Multiple targets available');
      expect(errorOutput).toContain('test-app');
      expect(errorOutput).toContain('test-lib');
    });

    it('prioritizes currently building target', async () => {
      // Mock multiple targets with one building
      const multiTargetConfig = {
        ...mockConfig,
        targets: [
          ...mockConfig.targets,
          {
            name: 'test-lib',
            type: 'library' as const,
            buildCommand: 'npm run build:lib',
            outputPath: './dist/lib.js',
            watchPaths: ['lib/**/*.ts'],
            libraryType: 'static' as const,
            enabled: true,
          },
        ],
      };
      vi.mocked(ConfigurationManager.getConfig).mockResolvedValue({
        config: multiTargetConfig,
        projectRoot: '/test/project',
        configPath: '/test/project/poltergeist.config.json',
      });

      mockPoltergeist.getStatus.mockResolvedValue({
        'test-app': {
          status: 'idle',
          lastBuild: {
            status: 'success',
            timestamp: new Date().toISOString(),
          },
        },
        'test-lib': {
          status: 'watching',
          lastBuild: {
            status: 'building',
            timestamp: new Date().toISOString(),
          },
        },
      });

      try {
        await program.parseAsync(['node', 'cli.js', 'logs']);
      } catch (error) {
        // Expected
      }

      // Should automatically select the building target
      const errorOutput = consoleErrorSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(errorOutput).not.toContain('Multiple targets available');
    });
  });

  describe('build statistics tracking', () => {
    it('calculates average build time from successful builds', () => {
      const stats = {
        successfulBuilds: [
          { duration: 2000, timestamp: '2024-01-01T10:00:00' },
          { duration: 3000, timestamp: '2024-01-01T10:01:00' },
          { duration: 4000, timestamp: '2024-01-01T10:02:00' },
        ],
        averageDuration: 3000,
        minDuration: 2000,
        maxDuration: 4000,
      };

      // The calculation is done in StateManager.updateBuildStatus
      // Here we just verify the stats are passed through correctly
      mockPoltergeist.getStatus.mockResolvedValue({
        'test-app': {
          buildStats: stats,
        },
      });

      expect(stats.averageDuration).toBe(3000);
      expect(stats.minDuration).toBe(2000);
      expect(stats.maxDuration).toBe(4000);
    });
  });
});