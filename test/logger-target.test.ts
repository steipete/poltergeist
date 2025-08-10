import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, createTargetLogger, SimpleLogger } from '../src/logger.js';

describe('Logger Target Support', () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'poltergeist-test-'));
    logFile = join(tempDir, 'test.log');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('SimpleLogger', () => {
    it('should include target in log entries', async () => {
      const logger = new SimpleLogger('my-target', 'info', logFile);

      logger.info('Test message', { someData: 'value' });
      logger.error('Error message');
      logger.warn('Warning message');

      // Give it a moment to write
      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await readFile(logFile, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      expect(lines).toHaveLength(3);

      // Check each log entry contains target in plain text format
      for (const line of lines) {
        expect(line).toContain('[my-target]');
        expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
      }

      // Check specific messages
      expect(lines[0]).toContain('Test message');
      expect(lines[1]).toContain('Error message');
      expect(lines[2]).toContain('Warning message');
    });

    it('should handle undefined target', async () => {
      const logger = new SimpleLogger(undefined, 'info', logFile);

      logger.info('Test without target');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await readFile(logFile, 'utf-8');
      const line = content.trim();

      // Should not contain target brackets when undefined
      expect(line).not.toContain('[');
      expect(line).toContain('Test without target');
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
    });
  });

  describe('createTargetLogger', () => {
    it('should wrap logger with target information', async () => {
      const baseLogger = new SimpleLogger(undefined, 'info', logFile);
      const targetLogger = createTargetLogger(baseLogger, 'wrapped-target');

      targetLogger.info('Message from wrapped logger');
      targetLogger.error('Error from wrapped logger');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await readFile(logFile, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      expect(lines).toHaveLength(2);

      // Check that messages are prefixed with target name
      expect(lines[0]).toContain('[wrapped-target]');
      expect(lines[0]).toContain('Message from wrapped logger');

      expect(lines[1]).toContain('[wrapped-target]');
      expect(lines[1]).toContain('Error from wrapped logger');
    });
  });

  describe('createLogger with target', () => {
    it('should create logger with target name', async () => {
      const logger = createLogger(logFile, 'info', 'test-target');

      // This will use SimpleLogger since LogTape might not be available in tests
      logger.info('Test message with target');

      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await readFile(logFile, 'utf-8');
      const line = content.trim();

      // When using SimpleLogger directly with target
      expect(line).toContain('[test-target]');
      expect(line).toContain('Test message with target');
    });
  });

  describe('Log filtering simulation', () => {
    it('should be able to filter logs by target', async () => {
      // Write logs manually to simulate multiple targets in one file
      const { appendFileSync } = await import('fs');

      const timestamp = new Date().toISOString();
      appendFileSync(logFile, `${timestamp} INFO : [target-a] Message from A\n`);
      appendFileSync(logFile, `${timestamp} INFO : [target-b] Message from B\n`);
      appendFileSync(logFile, `${timestamp} INFO : [target-a] Another from A\n`);
      appendFileSync(logFile, `${timestamp} INFO : Message without target\n`);
      appendFileSync(logFile, `${timestamp} INFO : [target-b] Another from B\n`);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const content = await readFile(logFile, 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      // Parse plain text format for filtering
      // Format: timestamp LEVEL : [target] message
      const entries = lines.map((line) => {
        // First match after "LEVEL : " to find target
        const parts = line.split(/(?:INFO|ERROR|WARN|DEBUG)\s*:\s*/);
        if (parts.length < 2) return { target: undefined, message: line };

        const afterLevel = parts[1];
        const targetMatch = afterLevel.match(/^\[([^\]]+)\]\s*/);

        if (targetMatch) {
          return {
            target: targetMatch[1],
            message: afterLevel.substring(targetMatch[0].length),
          };
        }
        return {
          target: undefined,
          message: afterLevel,
        };
      });

      // Debug: log what we parsed
      // console.log('Lines from file:', lines);
      // console.log('Parsed entries:', entries);

      // Filter by target-a
      const targetALogs = entries.filter((e) => e.target === 'target-a');
      expect(targetALogs).toHaveLength(2);
      expect(targetALogs[0].message).toBe('Message from A');
      expect(targetALogs[1].message).toBe('Another from A');

      // Filter by target-b
      const targetBLogs = entries.filter((e) => e.target === 'target-b');
      expect(targetBLogs).toHaveLength(2);
      expect(targetBLogs[0].message).toContain('Message from B');
      expect(targetBLogs[1].message).toContain('Another from B');

      // Logs without target
      const noTargetLogs = entries.filter((e) => !e.target);
      expect(noTargetLogs).toHaveLength(1);
      expect(noTargetLogs[0].message).toContain('Message without target');
    });
  });
});
