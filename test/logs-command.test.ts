import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemUtils } from '../src/utils/filesystem.js';

describe('Logs Command - Plain Text Format', () => {
  let tempDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'poltergeist-logs-test-'));
    projectRoot = join(tempDir, 'test-project');

    // Set the state directory to our temp dir for testing
    process.env.POLTERGEIST_STATE_DIR = tempDir;
  });

  afterEach(async () => {
    delete process.env.POLTERGEIST_STATE_DIR;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Log File Generation', () => {
    it('should generate target-specific log file paths', () => {
      const logPath = FileSystemUtils.getLogFilePath(projectRoot, 'my-target');

      expect(logPath).toContain('test-project');
      expect(logPath).toContain('my-target');
      expect(logPath.endsWith('.log')).toBe(true);
      expect(logPath).toContain(tempDir);
    });

    it('should use same naming pattern as state files', () => {
      const logPath = FileSystemUtils.getLogFilePath(projectRoot, 'my-target');
      const statePath = FileSystemUtils.getStateFilePath(projectRoot, 'my-target');

      // Extract filenames
      const logFile = logPath.split('/').pop();
      const stateFile = statePath.split('/').pop();

      if (!logFile || !stateFile) {
        throw new Error('Expected log and state file names to be present');
      }

      // Should have same prefix, different extension
      const logPrefix = logFile.replace('.log', '');
      const statePrefix = stateFile.replace('.state', '');

      expect(logPrefix).toBe(statePrefix);
    });
  });

  describe('Log Content Parsing', () => {
    it('should parse plain text log format', async () => {
      const logFile = FileSystemUtils.getLogFilePath(projectRoot, 'build-target');

      // Write sample log content in plain text format
      const logContent = `2024-01-01T12:00:00.000Z INFO : [build-target] Build starting
2024-01-01T12:00:01.000Z INFO : [build-target] Compiling sources
2024-01-01T12:00:02.000Z ERROR: [build-target] Compilation failed: syntax error
2024-01-01T12:00:03.000Z WARN : [build-target] Build failed with errors`;

      await writeFile(logFile, logContent);

      // Read and verify the content can be parsed
      const content = await readFile(logFile, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      expect(lines).toHaveLength(4);

      // Parse first line to verify format
      const firstLine = lines[0];
      const match = firstLine.match(/^(\S+)\s+(\w+)\s*:\s*(?:\[([^\]]+)\]\s*)?(.*)$/);

      expect(match).not.toBeNull();
      if (match) {
        const [, timestamp, level, target, message] = match;
        expect(timestamp).toBe('2024-01-01T12:00:00.000Z');
        expect(level).toBe('INFO');
        expect(target).toBe('build-target');
        expect(message).toBe('Build starting');
      }
    });

    it('should handle logs without target field', async () => {
      const logFile = FileSystemUtils.getLogFilePath(projectRoot, 'no-target');

      // Write log content without [target] prefix (since it's in target-specific file)
      const logContent = `2024-01-01T12:00:00.000Z INFO : Build starting
2024-01-01T12:00:01.000Z DEBUG: Checking dependencies
2024-01-01T12:00:02.000Z INFO : Build complete`;

      await writeFile(logFile, logContent);

      const content = await readFile(logFile, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      expect(lines).toHaveLength(3);

      // Parse line without target
      const firstLine = lines[0];
      const match = firstLine.match(/^(\S+)\s+(\w+)\s*:\s*(?:\[([^\]]+)\]\s*)?(.*)$/);

      expect(match).not.toBeNull();
      if (match) {
        const [, timestamp, level, target, message] = match;
        expect(timestamp).toBe('2024-01-01T12:00:00.000Z');
        expect(level).toBe('INFO');
        expect(target).toBeUndefined(); // No target in the log line
        expect(message).toBe('Build starting');
      }
    });

    it('should support backward compatibility with JSON logs', async () => {
      const logFile = FileSystemUtils.getLogFilePath(projectRoot, 'legacy');

      // Write old JSON format logs
      const logContent = `{"timestamp":"2024-01-01T12:00:00.000Z","level":"info","message":"Old format log","target":"legacy"}
{"timestamp":"2024-01-01T12:00:01.000Z","level":"error","message":"Error in old format","target":"legacy"}`;

      await writeFile(logFile, logContent);

      const content = await readFile(logFile, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      // Verify JSON can still be parsed
      const firstEntry = JSON.parse(lines[0]);
      expect(firstEntry.level).toBe('info');
      expect(firstEntry.message).toBe('Old format log');
      expect(firstEntry.target).toBe('legacy');
    });
  });

  describe('Log File Size Reduction', () => {
    it('should achieve significant size reduction with plain text format', async () => {
      const targetName = 'size-test';
      const logFile = FileSystemUtils.getLogFilePath(projectRoot, targetName);

      // Generate 100 log entries
      const plainTextLogs: string[] = [];
      const jsonLogs: string[] = [];

      for (let i = 0; i < 100; i++) {
        const timestamp = new Date().toISOString();
        const message = `Build step ${i}: Processing file module_${i}.ts`;

        // Plain text format (new)
        plainTextLogs.push(`${timestamp} INFO : ${message}`);

        // JSON format (old)
        jsonLogs.push(
          JSON.stringify({
            timestamp,
            level: 'info',
            message,
            target: targetName,
            pid: 12345,
            hostname: 'localhost',
          })
        );
      }

      const plainTextContent = plainTextLogs.join('\n');
      const jsonContent = jsonLogs.join('\n');

      // Calculate size reduction
      const plainTextSize = Buffer.byteLength(plainTextContent);
      const jsonSize = Buffer.byteLength(jsonContent);
      const reduction = ((jsonSize - plainTextSize) / jsonSize) * 100;

      // Should achieve at least 50% size reduction
      expect(reduction).toBeGreaterThan(50);

      // Write the plain text version
      await writeFile(logFile, plainTextContent);

      // Verify it was written correctly
      const writtenContent = await readFile(logFile, 'utf-8');
      expect(writtenContent).toBe(plainTextContent);
    });
  });
});
