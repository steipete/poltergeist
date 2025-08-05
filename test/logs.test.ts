// Tests for poltergeist logs command

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock console methods to capture output
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
  throw new Error(`Process exited with code ${code || 0}`);
});

// Import the program after mocks
import { program } from '../src/cli.js';

describe('Logs Command', () => {
  let testDir: string;
  let logFile: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
    mockExit.mockClear();

    // Store original cwd
    originalCwd = process.cwd();

    // Create temp directory for tests
    testDir = mkdirSync(join(tmpdir(), `poltergeist-logs-test-${Date.now()}`), { recursive: true });
    logFile = join(testDir, '.poltergeist.log');

    // Change to test directory
    process.chdir(testDir);

    // Create a test config file
    const configPath = join(testDir, 'poltergeist.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test-target',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "test"',
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
        logging: {
          file: '.poltergeist.log',
          level: 'info',
        },
      })
    );
  });

  afterEach(() => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Helper to run CLI command
  async function runLogsCommand(args: string[] = []): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: Error;
  }> {
    const stdout: string[] = [];
    const stderr: string[] = [];

    mockConsoleLog.mockImplementation((...args) => {
      stdout.push(args.join(' '));
    });

    mockConsoleError.mockImplementation((...args) => {
      stderr.push(args.join(' '));
    });

    try {
      await program.parseAsync(['node', 'poltergeist', 'logs', ...args]);
      return {
        exitCode: 0,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Process exited with code')) {
        const code = Number.parseInt(errorMessage.match(/code (\\d+)/)?.[1] || '1');
        return {
          exitCode: code,
          stdout: stdout.join('\n'),
          stderr: stderr.join('\n'),
          error,
        };
      }
      return {
        exitCode: 1,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        error,
      };
    }
  }

  // Helper to create sample log entries
  function createSampleLogFile(): void {
    const logEntries = [
      {
        timestamp: '2025-08-05T10:00:00.000Z',
        level: 'info',
        message: 'Starting Poltergeist',
        target: 'test-target',
      },
      {
        timestamp: '2025-08-05T10:00:01.000Z',
        level: 'success',
        message: 'Build completed successfully',
        target: 'test-target',
        buildTime: 1500,
      },
      {
        timestamp: '2025-08-05T10:00:02.000Z',
        level: 'warn',
        message: 'File watcher warning',
        target: 'test-target',
        files: ['src/test.ts'],
      },
      {
        timestamp: '2025-08-05T10:00:03.000Z',
        level: 'error',
        message: 'Build failed',
        target: 'test-target',
        exitCode: 1,
      },
      {
        timestamp: '2025-08-05T10:00:04.000Z',
        level: 'info',
        message: 'Starting other target',
        target: 'other-target',
      },
      {
        timestamp: '2025-08-05T10:00:05.000Z',
        level: 'debug',
        message: 'Debug information',
        target: 'test-target',
        pid: 12345,
      },
    ];

    const logContent = logEntries.map((entry) => JSON.stringify(entry)).join('\n');
    writeFileSync(logFile, logContent);
  }

  describe('Basic functionality', () => {
    it('should display all logs when log file exists', async () => {
      createSampleLogFile();

      const result = await runLogsCommand();

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('👻 Poltergeist Logs');
      expect(result.stdout).toContain('Starting Poltergeist');
      expect(result.stdout).toContain('Build completed successfully');
      expect(result.stdout).toContain('Build failed');
      expect(result.stdout).toContain('[test-target]');
      expect(result.stdout).toContain('[other-target]');
    });

    it('should show error when no log file exists', async () => {
      const result = await runLogsCommand();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('No log file found');
      expect(result.stderr).toContain('Start Poltergeist to generate logs');
    });

    it('should handle empty log file', async () => {
      writeFileSync(logFile, '');

      const result = await runLogsCommand();

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No logs found');
    });
  });

  describe('Filtering and formatting', () => {
    beforeEach(() => {
      createSampleLogFile();
    });

    it('should filter logs by target', async () => {
      const result = await runLogsCommand(['--target', 'other-target']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Starting other target');
      expect(result.stdout).toContain('[other-target]');
      expect(result.stdout).not.toContain('[test-target]');
    });

    it('should show message when target has no logs', async () => {
      const result = await runLogsCommand(['--target', 'nonexistent-target']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No logs found for target: nonexistent-target');
    });

    it('should limit number of lines', async () => {
      const result = await runLogsCommand(['--lines', '2']);

      expect(result.exitCode).toBe(0);
      // Should only show the last 2 entries
      expect(result.stdout).toContain('Starting other target');
      expect(result.stdout).toContain('Debug information');
      expect(result.stdout).not.toContain('Starting Poltergeist');
    });

    it('should output JSON format', async () => {
      const result = await runLogsCommand(['--json', '--lines', '2']);

      expect(result.exitCode).toBe(0);

      // Should be valid JSON
      let json: unknown;
      expect(() => {
        json = JSON.parse(result.stdout);
      }).not.toThrow();

      expect(Array.isArray(json)).toBe(true);
      expect(json).toHaveLength(2);
      expect((json as any[])[0]).toHaveProperty('timestamp');
      expect((json as any[])[0]).toHaveProperty('level');
      expect((json as any[])[0]).toHaveProperty('message');
      expect((json as any[])[0]).toHaveProperty('target');
    });

    it('should combine target filter and line limit', async () => {
      const result = await runLogsCommand(['--target', 'test-target', '--lines', '2']);

      expect(result.exitCode).toBe(0);
      // Should show last 2 entries for test-target only
      expect(result.stdout).toContain('[test-target]');
      expect(result.stdout).not.toContain('[other-target]');

      // Count the number of log entries (lines containing target markers)
      const logLines = result.stdout.split('\n').filter((line) => line.includes('[test-target]'));
      expect(logLines.length).toBe(2);
    });
  });

  describe('Log formatting', () => {
    beforeEach(() => {
      createSampleLogFile();
    });

    it('should format different log levels with colors', async () => {
      const result = await runLogsCommand();

      expect(result.exitCode).toBe(0);
      // The actual color codes won't be visible in test output,
      // but we can check that different levels are present
      expect(result.stdout).toContain('INFO');
      expect(result.stdout).toContain('SUCCESS');
      expect(result.stdout).toContain('WARN');
      expect(result.stdout).toContain('ERROR');
      expect(result.stdout).toContain('DEBUG');
    });

    it('should display metadata for log entries', async () => {
      const result = await runLogsCommand();

      expect(result.exitCode).toBe(0);
      // Check that metadata is displayed
      expect(result.stdout).toContain('"buildTime":1500');
      expect(result.stdout).toContain('"files":["src/test.ts"]');
      expect(result.stdout).toContain('"exitCode":1');
      expect(result.stdout).toContain('"pid":12345');
    });

    it('should handle malformed log entries gracefully', async () => {
      // Add some malformed entries
      const validEntry = JSON.stringify({
        timestamp: '2025-08-05T10:00:00.000Z',
        level: 'info',
        message: 'Valid entry',
        target: 'test-target',
      });

      const logContent = [
        validEntry,
        'invalid json line',
        '{"incomplete": "json"',
        validEntry,
      ].join('\n');

      writeFileSync(logFile, logContent);

      const result = await runLogsCommand();

      expect(result.exitCode).toBe(0);
      // Should still display valid entries
      expect(result.stdout).toContain('Valid entry');
      // Should have exactly 2 valid entries
      const logLines = result.stdout.split('\n').filter((line) => line.includes('Valid entry'));
      expect(logLines.length).toBe(2);
    });
  });

  describe('Command options', () => {
    beforeEach(() => {
      createSampleLogFile();
    });

    it('should respect custom config path', async () => {
      const customConfigPath = join(testDir, 'custom.config.json');
      const customLogFile = join(testDir, 'custom.log');

      writeFileSync(
        customConfigPath,
        JSON.stringify({
          version: '1.0',
          projectType: 'node',
          targets: [],
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
          logging: {
            file: 'custom.log',
            level: 'info',
          },
        })
      );

      writeFileSync(
        customLogFile,
        JSON.stringify({
          timestamp: '2025-08-05T10:00:00.000Z',
          level: 'info',
          message: 'Custom log entry',
          target: 'custom-target',
        })
      );

      const result = await runLogsCommand(['--config', customConfigPath]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Custom log entry');
    });
  });
});
