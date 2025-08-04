import { spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('polter fallback behavior', () => {
  // Use a unique temporary directory outside the Poltergeist project
  const testDir = join(os.tmpdir(), `pgrun-test-${Date.now()}`);
  const configPath = join(testDir, 'poltergeist.config.json');
  const binaryPath = join(testDir, 'test-cli');

  beforeEach(() => {
    // Clean up from previous tests
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should fall back to stale execution when no config is found', async () => {
    // Create a cross-platform mock binary (Node.js script)
    writeFileSync(binaryPath, 'console.log("test-output");', { mode: 0o755 });

    // Run polter from test directory (no config) - don't pass --help as it exits early
    const result = await runPolter(testDir, 'test-cli', [], { expectSuccess: true });

    expect(result.stderr).toContain('POLTERGEIST NOT RUNNING');
    expect(result.stderr).toContain('npm run poltergeist:haunt');
    expect(result.stdout).toContain('Running binary: test-cli (potentially stale)');
    expect(result.stdout).toContain('test-output');
  });

  it('should fall back to stale execution when target not found in config', async () => {
    // Create a valid config but without our target
    const config = {
      version: '1.0',
      projectType: 'node',
      targets: [
        {
          name: 'other-target',
          type: 'executable',
          enabled: true,
          outputPath: './other-binary',
          buildCommand: 'echo "build"',
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
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create a cross-platform mock binary (Node.js script)
    writeFileSync(binaryPath, 'console.log("fallback-output");', { mode: 0o755 });

    const result = await runPolter(testDir, 'test-cli', [], { expectSuccess: true });

    expect(result.stderr).toContain('POLTERGEIST NOT RUNNING');
    expect(result.stderr).toContain('Available configured targets:');
    expect(result.stderr).toContain('other-target');
    expect(result.stdout).toContain('fallback-output');
  });

  it('should handle missing binary gracefully', async () => {
    // No config and no binary
    const result = await runPolter(testDir, 'nonexistent-cli', [], { expectSuccess: false });

    expect(result.stderr).toContain("Binary not found for target 'nonexistent-cli'");
    expect(result.stderr).toContain('Tried the following locations:');
    expect(result.stderr).toContain('Try running a manual build first');
    expect(result.exitCode).toBe(1);
  });

  it('should show verbose output in fallback mode', async () => {
    // Create a cross-platform mock binary (Node.js script)
    writeFileSync(binaryPath, 'console.log("verbose-test");', { mode: 0o755 });

    const result = await runPolter(testDir, 'test-cli', [], {
      expectSuccess: true,
      verbose: true,
    });

    expect(result.stderr).toContain(
      'No poltergeist.config.json found - attempting stale execution'
    );
    expect(result.stdout).toContain('Project root:');
    expect(result.stdout).toContain('Binary path:');
    expect(result.stdout).toContain('Status: Executing without build verification');
  });

  it('should handle different binary extensions correctly', async () => {
    const jsPath = join(testDir, 'test-cli.js');
    writeFileSync(jsPath, 'console.log("js-output");');

    const result = await runPolter(testDir, 'test-cli.js', [], { expectSuccess: true });

    expect(result.stdout).toContain('Running binary: test-cli.js (potentially stale)');
    expect(result.stdout).toContain('js-output');
  });

  it('should try multiple binary discovery paths', async () => {
    // Create binary in build subdirectory
    const buildDir = join(testDir, 'build');
    mkdirSync(buildDir);
    const buildBinaryPath = join(buildDir, 'test-cli');
    writeFileSync(buildBinaryPath, 'console.log("build-output");', { mode: 0o755 });

    const result = await runPolter(testDir, 'test-cli', [], { expectSuccess: true });

    expect(result.stdout).toContain('Running binary: test-cli (potentially stale)');
    expect(result.stdout).toContain('build-output');
  });

  it('should handle cli suffix removal for binary discovery', async () => {
    // Create binary without -cli suffix
    const baseBinaryPath = join(testDir, 'myapp');
    writeFileSync(baseBinaryPath, 'console.log("base-app-output");', { mode: 0o755 });

    const result = await runPolter(testDir, 'myapp-cli', [], { expectSuccess: true });

    expect(result.stdout).toContain('Running binary: myapp-cli (potentially stale)');
    expect(result.stdout).toContain('base-app-output');
  });
});

/**
 * Helper function to strip ANSI escape codes from output
 */
function stripAnsiCodes(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence removal
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Helper function to run polter and capture output
 */
async function runPolter(
  cwd: string,
  target: string,
  args: string[] = [],
  options: {
    expectSuccess?: boolean;
    verbose?: boolean;
    timeout?: number;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { verbose = false, timeout = 10000 } = options;

  const polterPath = join(__dirname, '../dist/polter.js');
  const polterArgs = [];

  if (verbose) {
    polterArgs.push('--verbose');
  }

  polterArgs.push(target, ...args);

  return new Promise((resolve) => {
    const child = spawn('node', [polterPath, ...polterArgs], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }, // Disable colored output
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ stdout: stripAnsiCodes(stdout), stderr: stripAnsiCodes(stderr), exitCode: -1 });
    }, timeout);

    child.on('exit', (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: stripAnsiCodes(stdout),
        stderr: stripAnsiCodes(stderr),
        exitCode: code || 0,
      });
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: stripAnsiCodes(stdout),
        stderr: stripAnsiCodes(stderr + error.message),
        exitCode: 1,
      });
    });
  });
}
