// Tests for pgrun wrapper binary

import { spawn } from 'child_process';
import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve as resolvePath } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('pgrun Integration Tests', () => {
  const timestamp = Date.now();
  const testProjectRootRaw = join(tmpdir(), `pgrun-test-${timestamp}`);
  const testStateDir = join(tmpdir(), `poltergeist-pgrun-test-${timestamp}`);
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
    status: 'building' | 'success' | 'failed',
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

    // Use the correct state format that matches the actual implementation
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
  }

  function runPgrun(
    args: string[],
    options: { cwd?: string } = {}
  ): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve) => {
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

      child.on('exit', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });
    });
  }

  describe('Config Discovery', () => {
    it('should find config in current directory', async () => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);

      const result = await runPgrun(['test-tool']);
      expect(result.stderr).toContain('❌ Binary not found');
      expect(result.exitCode).toBe(1);
    });

    it('should find config in parent directory', async () => {
      const subDir = join(testProjectRoot, 'subdir');
      mkdirSync(subDir, { recursive: true });

      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);

      const result = await runPgrun(['test-tool'], { cwd: subDir });
      expect(result.stderr).toContain('❌ Binary not found');
      expect(result.exitCode).toBe(1);
    });

    it('should fail when no config found', async () => {
      const emptyDir = join(tmpdir(), `pgrun-empty-${Date.now()}`);
      mkdirSync(emptyDir, { recursive: true });

      const result = await runPgrun(['test-tool'], { cwd: emptyDir });
      expect(result.stderr).toContain('❌ No poltergeist.config.json found');
      expect(result.exitCode).toBe(1);

      rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  describe('Target Validation', () => {
    it('should fail for non-existent target', async () => {
      createTestConfig([
        {
          name: 'real-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/real-tool',
        },
      ]);

      const result = await runPgrun(['fake-tool']);
      expect(result.stderr).toContain("❌ Target 'fake-tool' not found");
      expect(result.stderr).toContain('Available executable targets:');
      expect(result.stderr).toContain('- real-tool');
      expect(result.exitCode).toBe(1);
    });

    it('should fail for non-executable target', async () => {
      createTestConfig([
        {
          name: 'my-lib',
          type: 'library',
          buildCommand: 'echo building',
          outputPath: 'dist/libmy.a',
        },
      ]);

      const result = await runPgrun(['my-lib']);
      expect(result.stderr).toContain("❌ Target 'my-lib' is not executable (type: library)");
      expect(result.exitCode).toBe(1);
    });

    it('should show helpful message when no executable targets exist', async () => {
      createTestConfig([
        {
          name: 'my-lib',
          type: 'library',
          buildCommand: 'echo building',
          outputPath: 'dist/libmy.a',
        },
      ]);

      const result = await runPgrun(['fake-tool']);
      expect(result.stderr).toContain('No executable targets found in config');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Build Status Handling', () => {
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

    it('should execute when build is successful', async () => {
      createTestBinary('dist/test-tool');
      createTestState('test-tool', 'success', false);

      const result = await runPgrun(['test-tool']);
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(result.stdout).toContain('Hello from test binary');
      expect(result.exitCode).toBe(0);
    });

    it('should fail when build failed and no --force', async () => {
      createTestBinary('dist/test-tool');
      createTestState('test-tool', 'failed', false);

      const result = await runPgrun(['test-tool']);
      expect(result.stderr).toContain('❌ Last build failed');
      expect(result.stderr).toContain('🔧 Run `poltergeist logs` for details or use --force');
      expect(result.exitCode).toBe(1);
    });

    it('should execute when build failed but --force specified', async () => {
      createTestBinary('dist/test-tool');
      createTestState('test-tool', 'failed', false);

      const result = await runPgrun(['test-tool', '--force']);
      expect(result.stderr).toContain('⚠️  Running despite build failure (--force specified)');
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(result.exitCode).toBe(0);
    });

    it('should handle unknown build status gracefully', async () => {
      createTestBinary('dist/test-tool');
      // No state file created = unknown status

      const result = await runPgrun(['test-tool']);
      expect(result.stderr).toContain('⚠️  Build status unknown, proceeding...');
      expect(result.stdout).toContain('✅ Running fresh binary: test-tool');
      expect(result.exitCode).toBe(0);
    });

    it('should fail when binary does not exist', async () => {
      createTestState('test-tool', 'success', false);
      // No binary created

      const result = await runPgrun(['test-tool']);
      expect(result.stderr).toContain('❌ Binary not found');
      expect(result.stderr).toContain('🔧 Try running: poltergeist start');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Command Line Options', () => {
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
      createTestState('test-tool', 'success', false);
    });

    it('should show version', async () => {
      const result = await runPgrun(['--version']);
      expect(result.stdout).toContain('1.0.0');
      expect(result.exitCode).toBe(0);
    });

    it('should show help', async () => {
      const result = await runPgrun(['--help']);
      expect(result.stdout).toContain('Smart wrapper for running executables');
      expect(result.stdout).toContain('--timeout');
      expect(result.stdout).toContain('--force');
      expect(result.stdout).toContain('--no-wait');
      expect(result.stdout).toContain('--verbose');
      expect(result.exitCode).toBe(0);
    });

    it('should pass arguments to target binary', async () => {
      // Create a binary that echoes its arguments
      createTestBinary('dist/test-tool', '#!/bin/bash\necho "Args: $@"\nexit 0');
      createTestState('test-tool', 'success', false);

      const result = await runPgrun(['test-tool', 'arg1', 'arg2', '--flag']);
      expect(result.stdout).toContain('Args: arg1 arg2 --flag');
      expect(result.exitCode).toBe(0);
    });

    it('should handle verbose output', async () => {
      const result = await runPgrun(['test-tool', '--verbose']);
      expect(result.stdout).toContain('📍 Project root:');
      expect(result.stdout).toContain('🎯 Target: test-tool');
      expect(result.stdout).toContain('📊 Build status:');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid config file', async () => {
      const configPath = join(testProjectRoot, 'poltergeist.config.json');
      writeFileSync(configPath, '{ invalid json }');

      const result = await runPgrun(['test-tool']);
      expect(result.stderr).toContain('❌ Error reading config');
      expect(result.exitCode).toBe(1);
    });

    it('should handle target without output path', async () => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          // Missing outputPath
        },
      ]);

      const result = await runPgrun(['test-tool']);
      expect(result.stderr).toContain("❌ Target 'test-tool' does not have an output path");
      expect(result.exitCode).toBe(1);
    });

    it('should handle corrupted state file', async () => {
      createTestConfig([
        {
          name: 'test-tool',
          type: 'executable',
          buildCommand: 'echo building',
          outputPath: 'dist/test-tool',
        },
      ]);
      createTestBinary('dist/test-tool');

      // Create corrupted state file
      const projectName = testProjectRoot.split('/').pop() || 'unknown';
      const projectHash = require('crypto')
        .createHash('sha256')
        .update(testProjectRoot)
        .digest('hex')
        .substring(0, 8);
      const fileName = `${projectName}-${projectHash}-test-tool.state`;
      const stateFilePath = join(testStateDir, fileName);
      writeFileSync(stateFilePath, '{ corrupted json }');

      const result = await runPgrun(['test-tool']);
      expect(result.stderr).toContain('⚠️  Build status unknown, proceeding...');
      expect(result.stdout).toContain('✅ Running fresh binary'); // Should continue anyway
      expect(result.exitCode).toBe(0);
    });
  });
});
