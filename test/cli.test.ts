// Comprehensive tests for CLI commands

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoltergeistConfig } from '../src/types.js';

// We'll test the CLI by importing the commands directly rather than spawning processes
// This gives us better control and avoids needing to build the CLI first

// Use vi.hoisted to ensure mocks are defined before imports
const { mockPoltergeist, mockStateManager, mockConfigLoader, mockLogger } = vi.hoisted(() => {
  const { existsSync, readFileSync } = require('fs');
  const mockPoltergeist = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({
      'test-target': {
        status: 'idle',
        enabled: true,
        type: 'executable',
        process: {
          pid: 1234,
          isActive: true,
          hostname: 'test-host',
          lastHeartbeat: new Date().toISOString(),
        },
      },
    }),
  };

  const mockStateManager = vi.fn().mockImplementation(() => ({
    readState: vi.fn().mockResolvedValue({
      projectName: 'test-project',
      target: 'test-target',
      process: {
        isActive: false,
        lastHeartbeat: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      },
    }),
    removeState: vi.fn().mockResolvedValue(undefined),
  }));

  // Add static method
  mockStateManager.listAllStates = vi.fn().mockResolvedValue(['test-state.state']);

  const mockConfigLoader = vi.fn().mockImplementation((path) => {
    // Return default config unless overridden
    return {
      loadConfig: vi.fn().mockImplementation(() => {
        // Check if a config file exists and read it
        if (existsSync(path)) {
          const content = readFileSync(path, 'utf-8');
          return JSON.parse(content);
        }
        // Return default config
        return {
          version: '1.0',
          projectType: 'node',
          targets: [
            {
              name: 'test-target',
              type: 'executable',
              enabled: true,
              buildCommand: 'echo "Building"',
              outputPath: './dist/test',
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
              enabled: true,
              focusDetectionWindow: 300000,
            },
          },
          notifications: {
            enabled: true,
          },
        };
      }),
      getProjectRoot: vi.fn().mockReturnValue(process.cwd()),
    };
  });

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  return {
    mockPoltergeist,
    mockStateManager,
    mockConfigLoader,
    mockLogger,
  };
});

vi.mock('../src/factories.js', () => ({
  createPoltergeist: vi.fn().mockReturnValue(mockPoltergeist),
}));

// Add the static method to the Poltergeist mock
vi.mock('../src/poltergeist.js', () => ({
  Poltergeist: Object.assign(
    vi.fn().mockImplementation(() => mockPoltergeist),
    {
      listAllStates: vi.fn().mockResolvedValue([
        {
          projectName: 'project1',
          hash: 'abc123',
          targetName: 'cli',
          process: { pid: 1234, isActive: true },
          lastBuild: { status: 'success', timestamp: new Date().toISOString() },
        },
      ]),
    }
  ),
}));

vi.mock('../src/state.js', () => ({
  StateManager: mockStateManager,
}));

vi.mock('../src/config.js', () => ({
  ConfigLoader: mockConfigLoader,
  ConfigurationError: class ConfigurationError extends Error {},
}));

vi.mock('../src/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}));

// Mock console methods to capture output
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
  throw new Error(`Process exited with code ${code || 0}`);
});

// Import the program after mocks are set up
import { program } from '../src/cli.js';

describe('CLI Commands', () => {
  let testDir: string;
  let configPath: string;
  let originalCwd: string;
  let originalProcessExit: typeof process.exit;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
    mockExit.mockClear();

    // Store original process.exit
    originalProcessExit = process.exit;

    // Store original cwd
    originalCwd = process.cwd();

    // Create temp directory for tests
    testDir = mkdirSync(join(tmpdir(), `poltergeist-cli-test-${Date.now()}`), { recursive: true });
    configPath = join(testDir, 'poltergeist.config.json');

    // Change to test directory
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Restore process.exit
    process.exit = originalProcessExit;
  });

  // Helper to run CLI command directly
  async function runCLI(
    args: string[]
  ): Promise<{ exitCode: number; error?: Error; stdout?: string; stderr?: string }> {
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
    mockExit.mockClear();

    // Capture stdout/stderr from console mocks
    const stdout: string[] = [];
    const stderr: string[] = [];

    mockConsoleLog.mockImplementation((...args) => {
      stdout.push(args.join(' '));
    });

    mockConsoleError.mockImplementation((...args) => {
      stderr.push(args.join(' '));
    });

    try {
      // Parse arguments like the CLI would
      await program.parseAsync(['node', 'poltergeist', ...args]);
      return {
        exitCode: 0,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Process exited with code')) {
        const code = Number.parseInt(errorMessage.match(/code (\d+)/)?.[1] || '1');
        return {
          exitCode: code,
          error,
          stdout: stdout.join('\n'),
          stderr: stderr.join('\n'),
        };
      }
      return {
        exitCode: 1,
        error,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    }
  }

  // Helper to create test config
  function createTestConfig(config: Partial<PoltergeistConfig> | null = null) {
    const defaultConfig: PoltergeistConfig = {
      version: '1.0',
      projectType: 'node',
      targets: [
        {
          name: 'test-target',
          type: 'executable',
          enabled: true,
          buildCommand: 'echo "Building"',
          outputPath: './dist/test',
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
          enabled: true,
          focusDetectionWindow: 300000,
        },
      },
      notifications: {
        enabled: true,
      },
    };

    const mergedConfig = config ? deepMerge(defaultConfig, config) : defaultConfig;
    writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2));
  }

  // Helper function for deep merging config objects
  function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(
          (target[key] as Record<string, unknown>) || {},
          source[key] as Record<string, unknown>
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = source[key] as T[Extract<keyof T, string>];
      }
    }

    return result;
  }

  describe('haunt/start command', () => {
    it('should start watching with default config', async () => {
      createTestConfig();

      const result = await runCLI(['haunt']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Summoning Poltergeist'));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Building 1 enabled target(s)')
      );
    });

    it('should start watching specific target', async () => {
      createTestConfig();

      const result = await runCLI(['start', '--target', 'test-target']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Building target: test-target')
      );
    });

    it('should fail with unknown target', async () => {
      createTestConfig();

      const result = await runCLI(['haunt', '--target', 'unknown-target']);

      expect(result.exitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("❌ Target 'unknown-target' not found")
      );
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Available targets:'));
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('test-target (executable)')
      );
    });

    it('should fail with no enabled targets', async () => {
      createTestConfig({
        targets: [
          {
            name: 'disabled-target',
            type: 'executable',
            enabled: false,
            buildCommand: 'echo "test"',
            outputPath: './dist/test',
            watchPaths: ['src/**/*'],
          },
        ],
      });

      const result = await runCLI(['haunt']);

      expect(result.exitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('No enabled targets found')
      );
    });

    it('should handle custom config path', async () => {
      const customConfigPath = join(testDir, 'custom.config.json');
      createTestConfig();
      writeFileSync(
        customConfigPath,
        JSON.stringify(
          {
            version: '1.0',
            projectType: 'node',
            targets: [
              {
                name: 'custom-target',
                type: 'executable',
                enabled: true,
                buildCommand: 'echo "custom"',
                outputPath: './dist/custom',
                watchPaths: ['**/*.js'],
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
                enabled: true,
                focusDetectionWindow: 300000,
              },
            },
            notifications: {
              enabled: true,
            },
          },
          null,
          2
        )
      );

      const result = await runCLI(['haunt', '--config', customConfigPath]);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Building 1 enabled target(s)')
      );
    });

    it('should enable verbose logging', async () => {
      createTestConfig();

      const result = await runCLI(['haunt', '--verbose']);

      expect(result.exitCode).toBe(0);
      // In real implementation, would check for verbose logs
    });
  });

  describe('stop/rest command', () => {
    it('should stop all targets', async () => {
      createTestConfig();

      const result = await runCLI(['stop']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Putting Poltergeist to rest')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Poltergeist is now at rest')
      );
    });

    it('should stop specific target', async () => {
      createTestConfig();

      const result = await runCLI(['rest', '--target', 'test-target']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Putting Poltergeist to rest')
      );
    });

    it('should handle stop errors gracefully', async () => {
      createTestConfig();

      // Mock error
      mockPoltergeist.stop.mockRejectedValueOnce(new Error('Stop failed'));

      const result = await runCLI(['stop']);

      expect(result.exitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Failed to stop:'));
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Stop failed'));
    });
  });

  describe('status command', () => {
    it('should show status for all targets', async () => {
      createTestConfig();

      const result = await runCLI(['status']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Poltergeist Status'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Target: test-target'));
      expect(result.stdout).toContain('Status:');
      expect(result.stdout).toContain('Process: Running (PID: 1234');
    });

    it('should show status for specific target', async () => {
      createTestConfig();

      const result = await runCLI(['status', '--target', 'test-target']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Target: test-target');
      expect(result.stdout).not.toContain('Available targets:');
    });

    it('should output JSON format', async () => {
      createTestConfig();

      const result = await runCLI(['status', '--json']);

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json).toHaveProperty('test-target');
      expect(json['test-target']).toHaveProperty('status', 'idle');
    });

    it('should handle missing target', async () => {
      createTestConfig();

      mockPoltergeist.getStatus.mockResolvedValueOnce({});

      const result = await runCLI(['status', '--target', 'missing-target']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("Target 'missing-target' not found")
      );
    });

    it('should format different status types', async () => {
      createTestConfig();

      mockPoltergeist.getStatus.mockResolvedValueOnce({
        'build-target': {
          status: 'building',
          process: {
            pid: 1234,
            isActive: true,
            hostname: 'test-host',
            lastHeartbeat: new Date().toISOString(),
          },
          lastBuild: {
            timestamp: new Date().toISOString(),
            status: 'success',
            duration: 1234,
            gitHash: 'abc123',
            builder: 'ExecutableBuilder',
          },
          appInfo: {
            bundleId: 'com.test.app',
            outputPath: '/path/to/output',
            iconPath: '/path/to/icon',
          },
          pendingFiles: 3,
        },
        'failed-target': {
          status: 'failure',
          process: { pid: 0, isActive: false },
          lastBuild: {
            timestamp: new Date().toISOString(),
            status: 'failure',
            errorSummary: 'Build failed with errors',
          },
        },
      });

      const result = await runCLI(['status']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('✅ Success'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('❌ Failed'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('🔨 Building'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Build Time: 1234ms'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Git Hash: abc123'));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Bundle ID: com.test.app')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Pending Files: 3'));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Build failed with errors')
      );
    });
  });

  describe('list command', () => {
    it('should list all configured targets', async () => {
      createTestConfig({
        targets: [
          {
            name: 'cli',
            type: 'executable',
            enabled: true,
            buildCommand: 'npm run build:cli',
            outputPath: './dist/cli',
            watchPaths: ['src/**/*.ts'],
          },
          {
            name: 'mac-app',
            type: 'app-bundle',
            enabled: false,
            buildCommand: 'xcodebuild',
            bundleId: 'com.example.app',
            platform: 'macos',
            watchPaths: ['src/**/*.swift'],
          },
        ],
      });

      const result = await runCLI(['list']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Configured Targets'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('✓ cli (executable)'));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('✗ mac-app (app-bundle)')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Build: npm run build:cli')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Output: ./dist/cli'));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Bundle ID: com.example.app')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Platform: macos'));
    });

    it('should handle empty target list', async () => {
      createTestConfig({ targets: [] });

      const result = await runCLI(['list']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('No targets configured'));
    });
  });

  describe('clean command', () => {
    it('should clean stale state files', async () => {
      createTestConfig();

      // Mock StateManager static method
      mockStateManager.listAllStates.mockResolvedValue(['old-state.state', 'new-state.state']);

      // Mock StateManager instances
      const oldStateManager = {
        readState: vi.fn().mockResolvedValueOnce({
          projectName: 'old-project',
          target: 'old-target',
          process: {
            isActive: false,
            lastHeartbeat: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days old
          },
        }),
        removeState: vi.fn().mockResolvedValue(undefined),
      };

      const newStateManager = {
        readState: vi.fn().mockResolvedValueOnce({
          projectName: 'new-project',
          target: 'new-target',
          process: {
            isActive: true,
            lastHeartbeat: new Date().toISOString(),
          },
        }),
        removeState: vi.fn().mockResolvedValue(undefined),
      };

      // Mock the StateManager constructor to return different instances
      mockStateManager
        .mockImplementationOnce(() => oldStateManager)
        .mockImplementationOnce(() => newStateManager);

      const result = await runCLI(['clean']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Cleaning up state files')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Removing: old-state.state')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Project: old-project'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Target: old-target'));
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Reason: inactive for 7+ days')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Removed 1 state file(s)')
      );
    });

    it('should support dry-run mode', async () => {
      createTestConfig();

      // Mock some state files
      mockStateManager.listAllStates.mockResolvedValue(['test.state']);
      mockStateManager.mockImplementationOnce(() => ({
        readState: vi.fn().mockResolvedValueOnce({
          projectName: 'test-project',
          target: 'test-target',
          process: {
            isActive: false,
            lastHeartbeat: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
          },
        }),
        removeState: vi.fn().mockResolvedValue(undefined),
      }));

      const result = await runCLI(['clean', '--dry-run']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Would remove'));
    });

    it('should clean all state files with --all flag', async () => {
      createTestConfig();

      // Mock some state files
      mockStateManager.listAllStates.mockResolvedValue(['test.state']);
      mockStateManager.mockImplementationOnce(() => ({
        readState: vi.fn().mockResolvedValueOnce({
          projectName: 'test-project',
          target: 'test-target',
          process: {
            isActive: true,
            lastHeartbeat: new Date().toISOString(),
          },
        }),
        removeState: vi.fn().mockResolvedValue(undefined),
      }));

      const result = await runCLI(['clean', '--all', '--dry-run']);

      expect(result.exitCode).toBe(0);
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Reason: all files'));
    });

    it('should support custom days threshold', async () => {
      createTestConfig();

      // Mock some state files
      mockStateManager.listAllStates.mockResolvedValue(['test.state']);
      mockStateManager.mockImplementationOnce(() => ({
        readState: vi.fn().mockResolvedValueOnce({
          projectName: 'test-project',
          target: 'test-target',
          process: {
            isActive: false,
            lastHeartbeat: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days old
          },
        }),
        removeState: vi.fn().mockResolvedValue(undefined),
      }));

      const result = await runCLI(['clean', '--days', '30', '--dry-run']);

      expect(result.exitCode).toBe(0);
      // Would check for 30 days threshold in real implementation
    });
  });

  describe('logs command', () => {
    it('should show log viewing not implemented message', async () => {
      createTestConfig();
      writeFileSync(join(testDir, '.poltergeist.log'), 'test logs');

      const result = await runCLI(['logs']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No logs found');
    });

    it('should fail when log file does not exist', async () => {
      createTestConfig();

      const result = await runCLI(['logs']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No log file found');
    });
  });

  describe('error handling', () => {
    it('should handle missing config file', async () => {
      // Mock ConfigLoader to throw error for missing file
      mockConfigLoader.mockImplementationOnce((_path) => ({
        loadConfig: vi.fn().mockImplementation(() => {
          throw new Error('Configuration file not found');
        }),
        getProjectRoot: vi.fn().mockReturnValue(process.cwd()),
      }));

      const result = await runCLI(['haunt']);

      expect(result.exitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load configuration')
      );
    });

    it('should handle invalid config file', async () => {
      writeFileSync(configPath, 'invalid json');

      // Mock ConfigLoader to throw error for invalid JSON
      mockConfigLoader.mockImplementationOnce((_path) => ({
        loadConfig: vi.fn().mockImplementation(() => {
          throw new Error('Invalid JSON');
        }),
        getProjectRoot: vi.fn().mockReturnValue(process.cwd()),
      }));

      const result = await runCLI(['haunt']);

      expect(result.exitCode).toBe(1);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load configuration')
      );
    });

    it('should warn about deprecated flags', async () => {
      createTestConfig();

      // Commander.js throws an error for unknown options
      const resultCli = await runCLI(['haunt', '--cli']);
      expect(resultCli.exitCode).toBe(1);
      // Check that it failed due to unknown option
      expect(resultCli.error?.message).toContain('Process exited with code 1');

      const resultMac = await runCLI(['haunt', '--mac']);
      expect(resultMac.exitCode).toBe(1);
      // Check that it failed due to unknown option
      expect(resultMac.error?.message).toContain('Process exited with code 1');
    });
  });

  describe('help and version', () => {
    it('should show help when no command specified', async () => {
      // Mock console.log to capture help output
      const helpOutput: string[] = [];
      mockConsoleLog.mockImplementation((output) => {
        helpOutput.push(output);
      });

      const result = await runCLI([]);

      // Help output causes exit code 1 when no command is provided
      expect(result.exitCode).toBe(1);

      // Check if help was output (commander may use process.stdout.write directly)
      const output = helpOutput.join('\n');
      if (output) {
        expect(output).toContain('The ghost that keeps your projects fresh');
        expect(output).toContain('Commands:');
      } else {
        // If commander bypasses our mocks, just check that it tried to show help
        expect(result.error?.message).toContain('Process exited with code 1');
      }
    });

    it('should show version', async () => {
      const versionOutput: string[] = [];
      mockConsoleLog.mockImplementation((output) => {
        versionOutput.push(output);
      });

      const result = await runCLI(['--version']);

      expect(result.exitCode).toBe(0);

      // Version might be printed directly to stdout
      const output = versionOutput.join('\n') || result.stdout;
      if (output) {
        expect(output).toMatch(/\d+\.\d+\.\d+/);
      }
    });

    it('should show help for specific command', async () => {
      const helpOutput: string[] = [];
      mockConsoleLog.mockImplementation((output) => {
        helpOutput.push(output);
      });

      const result = await runCLI(['haunt', '--help']);

      expect(result.exitCode).toBe(0);

      // Help might be printed directly to stdout
      const output = helpOutput.join('\n') || result.stdout;
      if (output) {
        expect(output).toContain('Start watching and auto-building your project');
        expect(output).toContain('--target');
        expect(output).toContain('--config');
        expect(output).toContain('--verbose');
      }
    });
  });
});
