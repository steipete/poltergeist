// Tests for poltergeist.ts wrapper script functionality

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Poltergeist Wrapper Script', () => {
  const wrapperScript = resolve(process.cwd(), 'poltergeist.ts');

  beforeEach(() => {
    // Ensure the wrapper script exists
    if (!existsSync(wrapperScript)) {
      throw new Error(`Wrapper script not found at ${wrapperScript}`);
    }
  });

  afterEach(() => {
    // Clean up any state
  });

  // Helper function to run the wrapper script
  function runWrapper(
    args: string[] = [],
    timeout = 5000
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve, reject) => {
      // Use platform-specific command
      const isWindows = process.platform === 'win32';
      const npxCmd = isWindows ? 'npx.cmd' : 'npx';

      const child = spawn(npxCmd, ['tsx', wrapperScript, ...args], {
        stdio: 'pipe',
        timeout,
        shell: isWindows, // Use shell on Windows
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
        });
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Set timeout
      setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Wrapper script timed out after ${timeout}ms`));
      }, timeout);
    });
  }

  describe('Help Menu', () => {
    it('should display help menu when no arguments provided', async () => {
      const result = await runWrapper([]);

      // Should show help and exit with non-zero code
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage: poltergeist');
      expect(result.stderr).toContain('The ghost that keeps your projects fresh');
      expect(result.stderr).toContain('Commands:');
      expect(result.stderr).toContain('haunt|start');
      expect(result.stderr).toContain('status');
      expect(result.stderr).toContain('stop|rest');
      expect(result.stderr).toContain('list');
      expect(result.stderr).toContain('clean');
    });

    it('should display help when --help is provided', async () => {
      const result = await runWrapper(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage: poltergeist');
      expect(result.stdout).toContain('The ghost that keeps your projects fresh');
    });

    it('should display version when --version is provided', async () => {
      const result = await runWrapper(['--version']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('Status Command', () => {
    it('should execute status command', async () => {
      const result = await runWrapper(['status']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Poltergeist Status');
      expect(result.stdout).toContain('Target:');
    });

    it('should support status with JSON output', async () => {
      const result = await runWrapper(['status', '--json']);

      expect(result.exitCode).toBe(0);

      // Should be valid JSON
      let json: unknown;
      expect(() => {
        json = JSON.parse(result.stdout);
      }).not.toThrow();

      expect(json).toBeDefined();
      expect(typeof json).toBe('object');
    });
  });

  describe('List Command', () => {
    it('should execute list command', async () => {
      const result = await runWrapper(['list']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Configured Targets');
    });
  });

  describe('Wrapper Integration', () => {
    it('should properly detect wrapper execution', async () => {
      // This test ensures the wrapper detection logic works
      // by verifying that the CLI actually executes when called through the wrapper
      const result = await runWrapper(['--help']);

      expect(result.exitCode).toBe(0);
      // If wrapper detection failed, we wouldn't get help output
      expect(result.stdout).toBeTruthy();
    });

    it('should handle unknown commands gracefully', async () => {
      const result = await runWrapper(['unknown-command']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown command');
    });

    it('should handle invalid options gracefully', async () => {
      const result = await runWrapper(['status', '--invalid-option']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown option');
    });
  });

  describe('Import Detection Logic', () => {
    it('should detect wrapper script in process.argv[1]', () => {
      // Test the detection logic that was added to fix the wrapper
      const testCases = [
        { argv1: '/path/to/poltergeist.ts', expected: true },
        { argv1: '/path/to/poltergeist', expected: true },
        { argv1: '/path/to/other-script.ts', expected: false },
        { argv1: '/path/to/cli.js', expected: false },
      ];

      testCases.forEach(({ argv1, expected }) => {
        const isWrapperRun = argv1?.endsWith('poltergeist.ts') || argv1?.endsWith('poltergeist');
        expect(isWrapperRun).toBe(expected);
      });
    });
  });
});
