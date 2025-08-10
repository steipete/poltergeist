// Tests for plain text logging functionality

import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, SimpleLogger } from '../src/logger.js';
import { FileSystemUtils } from '../src/utils/filesystem.js';

describe('Plain Text Logging', () => {
  let testDir: string;
  let _logFile: string;

  beforeEach(() => {
    // Create a test directory for log files
    testDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.env.POLTERGEIST_STATE_DIR = testDir;
  });

  afterEach(() => {
    // Clean up test directory
    delete process.env.POLTERGEIST_STATE_DIR;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('SimpleLogger', () => {
    it('should create logger with correct properties', () => {
      const logger = new SimpleLogger('test-target', 'info');

      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
      expect(logger.success).toBeDefined();
    });

    it('should respect log level filtering', () => {
      // Test that log level filtering works via console spy
      const originalLog = console.log;
      const originalError = console.error;
      const logSpy = vi.fn();
      const errorSpy = vi.fn();
      console.log = logSpy;
      console.error = errorSpy;

      const logger = new SimpleLogger('test-target', 'error');

      logger.debug('Debug msg'); // Should not log
      logger.info('Info msg'); // Should not log
      logger.warn('Warn msg'); // Should not log
      logger.error('Error msg'); // Should log

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);

      console.log = originalLog;
      console.error = originalError;
    });
  });

  describe('Log File Naming', () => {
    it('should generate correct log file names for targets', () => {
      const projectRoot = '/Users/test/my-project';
      const targetName = 'debug-build';

      const logFileName = FileSystemUtils.generateLogFileName(projectRoot, targetName);

      // Format: {projectName}-{hash}-{target}.log
      expect(logFileName).toMatch(/^my-project-[a-f0-9]{8}-debug-build\.log$/);
    });

    it('should use same naming pattern as state files', () => {
      const projectRoot = '/Users/test/my-project';
      const targetName = 'release';

      const stateFileName = FileSystemUtils.generateStateFileName(projectRoot, targetName);
      const logFileName = FileSystemUtils.generateLogFileName(projectRoot, targetName);

      // Should have same prefix but different extension
      const statePrefix = stateFileName.replace('.state', '');
      const logPrefix = logFileName.replace('.log', '');

      expect(statePrefix).toBe(logPrefix);
    });

    it('should generate consistent hashes for same project', () => {
      const projectRoot = '/Users/test/my-project';

      const log1 = FileSystemUtils.generateLogFileName(projectRoot, 'target1');
      const log2 = FileSystemUtils.generateLogFileName(projectRoot, 'target2');

      // Extract hashes
      const hash1 = log1.match(/-([a-f0-9]{8})-/)?.[1];
      const hash2 = log2.match(/-([a-f0-9]{8})-/)?.[1];

      expect(hash1).toBe(hash2); // Same project, same hash
    });
  });

  describe('Target-specific logging', () => {
    it('should create separate log files per target', () => {
      const projectRoot = '/Users/test/my-project';

      const logFile1 = FileSystemUtils.getLogFilePath(projectRoot, 'frontend');
      const logFile2 = FileSystemUtils.getLogFilePath(projectRoot, 'backend');

      expect(logFile1).not.toBe(logFile2);
      expect(logFile1).toContain('frontend.log');
      expect(logFile2).toContain('backend.log');
    });

    it('should format messages with target in console output', () => {
      const originalLog = console.log;
      const logSpy = vi.fn();
      console.log = logSpy;

      const logger = new SimpleLogger('my-target', 'info');
      logger.info('Building project');

      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain('[my-target]');
      expect(output).toContain('Building project');

      console.log = originalLog;
    });
  });

  describe('createLogger factory', () => {
    it('should create logger with target-specific file', () => {
      const projectRoot = '/Users/test/my-project';
      const targetName = 'test-target';
      const logFile = FileSystemUtils.getLogFilePath(projectRoot, targetName);

      const logger = createLogger(logFile, 'info', targetName);

      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.debug).toBeDefined();
      expect(logger.success).toBeDefined();
    });

    it('should respect log level settings', () => {
      // Mock console methods to test filtering
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      const logSpy = vi.fn();
      const errorSpy = vi.fn();
      const warnSpy = vi.fn();
      console.log = logSpy;
      console.error = errorSpy;
      console.warn = warnSpy;

      // Create a SimpleLogger directly with error level
      const logger = new SimpleLogger(undefined, 'error');

      logger.debug('Debug msg');
      logger.info('Info msg');
      logger.warn('Warn msg');
      logger.error('Error msg');

      // Only error should be logged
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    });
  });
});
