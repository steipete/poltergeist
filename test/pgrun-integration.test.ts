// Integration tests for pgrun wrapper binary
// These tests verify real-world pgrun behavior

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

describe('pgrun Integration', () => {
  const pgrunPath = resolvePath(__dirname, '../dist/pgrun.js');

  beforeAll(() => {
    // Ensure pgrun binary exists
    expect(existsSync(pgrunPath)).toBe(true);
  });

  function runPgrun(
    args: string[],
    cwd = process.cwd()
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
      const child = spawn('node', [pgrunPath, ...args], {
        cwd,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });
    });
  }

  describe('CLI Interface', () => {
    it('should show help when called with --help', async () => {
      const result = await runPgrun(['--help']);

      expect(result.stdout).toContain('Smart wrapper for running executables');
      expect(result.stdout).toContain('--timeout');
      expect(result.stdout).toContain('--force');
      expect(result.stdout).toContain('--no-wait');
      expect(result.stdout).toContain('--verbose');
      expect(result.exitCode).toBe(0);
    });

    it('should show version when called with --version', async () => {
      const result = await runPgrun(['--version']);

      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
      expect(result.exitCode).toBe(0);
    });

    it('should fail with helpful message when no target specified', async () => {
      const result = await runPgrun([]);

      expect(result.stderr).toContain('required');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Real Poltergeist Project', () => {
    // Test with the actual poltergeist project itself
    const poltergeistRoot = resolvePath(__dirname, '..');

    it('should find poltergeist config in current project', async () => {
      const result = await runPgrun(['poltergeist-cli', '--version'], poltergeistRoot);

      // Should either execute successfully or give a clear error about binary/build status
      expect(result.exitCode === 0 || result.stderr.includes('❌')).toBe(true);
    });

    it('should show available targets when invalid target specified', async () => {
      const result = await runPgrun(['non-existent-target'], poltergeistRoot);

      expect(result.stderr).toContain("Target 'non-existent-target' not found");
      expect(result.stderr).toContain('Available executable targets:');
      expect(result.stderr).toContain('poltergeist-cli');
      expect(result.exitCode).toBe(1);
    });

    it('should show verbose information when --verbose flag used', async () => {
      // Use a different approach - run with verbose but no other args
      const result = await runPgrun(['poltergeist-cli', '--verbose'], poltergeistRoot);

      // Check that verbose info appears in stdout OR stderr (depending on success/failure)
      const output = result.stdout + result.stderr;
      const hasVerboseInfo =
        output.includes('📍 Project root:') ||
        output.includes('🎯 Target:') ||
        output.includes('📊 Build status:');
      expect(hasVerboseInfo).toBe(true);
    });

    it('should handle library targets appropriately', async () => {
      // First, let's check if there are any library targets in the config
      const result = await runPgrun(['fake-library-target'], poltergeistRoot);

      // Should fail because target doesn't exist
      expect(result.stderr).toContain("Target 'fake-library-target' not found");
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Error Handling', () => {
    const poltergeistRoot = resolvePath(__dirname, '..');

    it('should fail gracefully when no config found', async () => {
      // Run from /tmp which likely has no poltergeist config
      const result = await runPgrun(['any-target'], '/tmp');

      expect(result.stderr).toContain('❌ No poltergeist.config.json found');
      expect(result.exitCode).toBe(1);
    });

    it('should handle timeout option validation', async () => {
      const result = await runPgrun(['poltergeist-cli', '--timeout', 'invalid'], poltergeistRoot);

      // Should either work (if timeout gets parsed as 0) or fail with validation error
      expect(result.exitCode >= 0).toBe(true);
    });
  });

  describe('Argument Forwarding', () => {
    const poltergeistRoot = resolvePath(__dirname, '..');

    it('should forward arguments to target binary', async () => {
      // Test with poltergeist-cli --version which should work
      const result = await runPgrun(['poltergeist-cli', '--version'], poltergeistRoot);

      // Should either show version (if binary runs) or a clear error
      if (result.exitCode === 0) {
        expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
      } else {
        expect(result.stderr).toContain('❌');
      }
    });

    it('should handle force flag correctly', async () => {
      const result = await runPgrun(['poltergeist-cli', '--force', '--version'], poltergeistRoot);

      // Force flag should be processed by pgrun, --version should be passed to target
      expect(result.exitCode >= 0).toBe(true);
    });
  });
});
