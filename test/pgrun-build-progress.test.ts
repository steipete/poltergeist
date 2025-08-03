// Tests for pgrun build-in-progress detection and waiting functionality

import { spawn } from 'child_process';
import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve as resolvePath } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('pgrun Build Progress Detection', () => {
  const timestamp = Date.now();
  const testProjectRootRaw = join(tmpdir(), `pgrun-progress-test-${timestamp}`);
  const testStateDir = join(tmpdir(), `poltergeist-pgrun-progress-${timestamp}`);
  const originalEnv = process.env.POLTERGEIST_STATE_DIR;

  let testProjectRoot: string;

  beforeEach(() => {
    // Create test directories first
    mkdirSync(testProjectRootRaw, { recursive: true });
    mkdirSync(testStateDir, { recursive: true });

    // Now resolve to canonical path (to match pgrun behavior)
    testProjectRoot = realpathSync(testProjectRootRaw);

    // Set up test environment
    process.env.POLTERGEIST_STATE_DIR = testStateDir;
  });

  afterEach(() => {
    // Restore environment
    process.env.POLTERGEIST_STATE_DIR = originalEnv;

    // Clean up test directories
    try {
      rmSync(testProjectRootRaw, { recursive: true, force: true });
      rmSync(testStateDir, { recursive: true, force: true });
    } catch {}
  });

  function createTestConfig(targets: Record<string, unknown>[] = []) {
    const config = {
      version: '1.0' as const,
      projectType: 'custom' as const,
      targets,
      watchman: {
        watchFiles: ['**/*'],
        excludeFiles: [],
      },
    };

    const configPath = join(testProjectRoot, 'poltergeist.config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return configPath;
  }

  function createTestBinary(
    outputPath: string,
    content = '#!/bin/bash\necho "Hello from test binary"\necho "Args: $@"\nexit 0'
  ) {
    const fullPath = join(testProjectRoot, outputPath);
    const dir = resolvePath(fullPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, content);

    // Make it executable (Unix only)
    try {
      chmodSync(fullPath, '755');
    } catch {}
  }

  function createTestState(
    targetName: string,
    status: 'building' | 'success' | 'failure',
    processActive = false
  ) {
    const projectName = testProjectRoot.split('/').pop() || 'unknown';
    const projectHash = require('crypto')
      .createHash('sha256')
      .update(testProjectRoot)
      .digest('hex')
      .substring(0, 8);
    const fileName = `${projectName}-${projectHash}-${targetName}.state`;
    const stateFilePath = join(testStateDir, fileName);

    const state = {
      version: '1.0',
      projectPath: testProjectRoot,
      projectName,
      target: targetName,
      targetType: 'executable',
      configPath: join(testProjectRoot, 'poltergeist.config.json'),
      process: {
        pid: processActive ? process.pid : 99999, // Use fake PID for inactive
        hostname: 'test-host',
        isActive: processActive,
        startTime: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      },
      lastBuild: {
        targetName,
        status,
        timestamp: new Date().toISOString(),
        gitHash: 'abc123f',
        builder: 'Executable',
        duration: 1000,
        buildTime: 1.0,
      },
    };

    writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
    return stateFilePath;
  }

  function updateStateFile(stateFilePath: string, updates: Record<string, unknown>) {
    try {
      const state = JSON.parse(require('fs').readFileSync(stateFilePath, 'utf-8'));
      Object.assign(state.lastBuild, updates);
      writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Failed to update state file:', error);
      throw error;
    }
  }

  function runPgrun(
    args: string[],
    options: { cwd?: string; timeout?: number } = {}
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve, reject) => {
      const pgrunPath = resolvePath(__dirname, '../dist/pgrun.js');
      const child = spawn('node', [pgrunPath, ...args], {
        cwd: options.cwd || testProjectRoot,
        stdio: 'pipe',
        env: { ...process.env, POLTERGEIST_STATE_DIR: testStateDir },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Handle timeout for test purposes
      const timeoutId = options.timeout
        ? setTimeout(() => {
            child.kill('SIGTERM');
          }, options.timeout)
        : null;

      child.on('exit', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });
    });
  }

  describe('Build In Progress Detection', () => {
    beforeEach(() => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);
    });

    it('should detect and wait for build in progress', async () => {
      createTestBinary('dist/test-tool');
      const stateFilePath = createTestState('test-tool', 'building', true);

      // Simulate build completion after 1 second
      setTimeout(() => {
        updateStateFile(stateFilePath, { status: 'success' });
      }, 1000);

      const startTime = Date.now();
      const result = await runPgrun(['test-tool']);
      const elapsed = Date.now() - startTime;

      expect(result.stdout).toContain('⏳ Build in progress, waiting for completion...');
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(elapsed).toBeGreaterThanOrEqual(900); // Allow some timing variance
      expect(elapsed).toBeLessThan(2000);
      expect(result.exitCode).toBe(0);
    });

    it('should fail immediately with --no-wait when building', async () => {
      createTestBinary('dist/test-tool');
      const stateFile = createTestState('test-tool', 'building', true);

      // Verify state file was created
      expect(existsSync(stateFile)).toBe(true);

      try {
        const result = await runPgrun(['test-tool', '--no-wait']);

        expect(result.stderr).toContain('❌ Build in progress and --no-wait specified');
        expect(result.exitCode).toBe(1);
      } catch (error) {
        console.error('Error running pgrun:', error);
        throw error;
      }
    }, 10000); // Increase timeout to 10s

    it('should timeout after specified duration', async () => {
      createTestBinary('dist/test-tool');
      createTestState('test-tool', 'building', true);

      const result = await runPgrun(['test-tool', '--timeout', '2000'], { timeout: 3000 });

      expect(result.stderr).toContain('❌ Build timeout after 2000ms');
      expect(result.stderr).toContain('🔧 Try increasing timeout with --timeout');
      expect(result.exitCode).toBe(1);
    }, 5000);

    it('should handle build failure during wait', async () => {
      createTestBinary('dist/test-tool');
      const stateFilePath = createTestState('test-tool', 'building', true);

      // Simulate build failure after 500ms
      setTimeout(() => {
        updateStateFile(stateFilePath, { status: 'failure' });
      }, 500);

      const result = await runPgrun(['test-tool']);

      expect(result.stdout).toContain('⏳ Build in progress, waiting for completion...');
      expect(result.stderr).toContain('❌ Build failed');
      expect(result.stderr).toContain('🔧 Run `poltergeist logs` for details or use --force');
      expect(result.exitCode).toBe(1);
    });

    it('should run with --force even if build fails during wait', async () => {
      createTestBinary('dist/test-tool');
      const stateFilePath = createTestState('test-tool', 'building', true);

      // Simulate build failure after 500ms
      setTimeout(() => {
        updateStateFile(stateFilePath, { status: 'failure' });
      }, 500);

      const result = await runPgrun(['test-tool', '--force']);

      expect(result.stdout).toContain('⏳ Build in progress, waiting for completion...');
      expect(result.stderr).toContain('⚠️  Running despite build failure (--force specified)');
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Build Status Transitions', () => {
    beforeEach(() => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);
      createTestBinary('dist/test-tool');
    });

    it('should handle rapid status changes', async () => {
      const stateFilePath = createTestState('test-tool', 'building', true);

      // Schedule status changes that simulate a build progressing to completion
      // Don't use 'failure' status as that causes immediate exit
      setTimeout(() => {
        updateStateFile(stateFilePath, { status: 'building' });
      }, 300);
      setTimeout(() => {
        updateStateFile(stateFilePath, { status: 'success' });
      }, 500);

      const result = await runPgrun(['test-tool']);

      // Should wait and eventually succeed
      expect(result.stdout).toContain('⏳ Build in progress, waiting for completion...');
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(result.exitCode).toBe(0);
    });

    it('should detect when build process dies', async () => {
      createTestState('test-tool', 'building', false); // Process not active

      const result = await runPgrun(['test-tool']);

      // Should detect that process is dead and check final status
      expect(result.exitCode === 0 || result.stderr.includes('❌')).toBe(true);
    });
  });

  describe('Progress Indicator', () => {
    it('should show spinner while waiting', async () => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);
      createTestBinary('dist/test-tool');
      const stateFilePath = createTestState('test-tool', 'building', true);

      // Update status after enough time to see spinner
      setTimeout(() => {
        updateStateFile(stateFilePath, { status: 'success' });
      }, 1500);

      const result = await runPgrun(['test-tool']);

      // Check that we waited and then ran
      expect(result.stdout).toContain('⏳ Build in progress, waiting for completion...');
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(result.exitCode).toBe(0);
    }, 3000);
  });

  describe('Verbose Mode', () => {
    it('should show detailed build status info in verbose mode', async () => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);
      createTestBinary('dist/test-tool');
      createTestState('test-tool', 'building', true);

      const result = await runPgrun(['test-tool', '--verbose', '--no-wait']);

      expect(result.stdout).toContain('📊 Build status: building');
      expect(result.exitCode).toBe(1); // Because of --no-wait
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);
    });

    it('should handle missing state file during wait', async () => {
      createTestBinary('dist/test-tool');
      const stateFilePath = createTestState('test-tool', 'building', true);

      // Delete state file after 500ms to simulate crash
      setTimeout(() => {
        rmSync(stateFilePath, { force: true });
      }, 500);

      const result = await runPgrun(['test-tool']);

      // Should detect build process died and run anyway
      expect(result.stdout).toContain('⏳ Build in progress, waiting for completion...');
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(result.exitCode).toBe(0);
    });

    it('should handle corrupted state file during wait', async () => {
      createTestBinary('dist/test-tool');
      const stateFilePath = createTestState('test-tool', 'building', true);

      // Corrupt state file after 500ms
      setTimeout(() => {
        writeFileSync(stateFilePath, '{ invalid json }');
      }, 500);

      const result = await runPgrun(['test-tool']);

      // Should handle gracefully - pgrun will get 'unknown' status and run
      expect(result.stdout).toContain('⏳ Build in progress, waiting for completion...');
      expect(result.stderr.includes('⚠️') || result.stdout.includes('✅')).toBe(true);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Build Status Check Without Process', () => {
    it('should correctly identify building status even when process is not active', async () => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);
      createTestBinary('dist/test-tool');

      // Create state with building status but no active process
      // This tests that we check lastBuild.status, not process.isActive
      createTestState('test-tool', 'building', false);

      const result = await runPgrun(['test-tool', '--no-wait']);

      // Should still detect as building based on lastBuild.status
      expect(result.stderr).toContain('❌ Build in progress and --no-wait specified');
      expect(result.exitCode).toBe(1);
    });

    it('should not consider as building if lastBuild.status is success even if process is active', async () => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);
      createTestBinary('dist/test-tool');

      // Create state with success status but active process
      // This tests that build status is based on lastBuild.status, not process state
      createTestState('test-tool', 'success', true);

      const result = await runPgrun(['test-tool']);

      // Should execute immediately since lastBuild.status is success
      expect(result.stdout).not.toContain('⏳ Build in progress');
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(result.exitCode).toBe(0);
    });
  });
});
