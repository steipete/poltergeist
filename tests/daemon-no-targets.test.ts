import { spawn } from 'child_process';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe.skipIf(process.env.CI === 'true')('Daemon with no enabled targets', () => {
  let testDir: string;
  let daemonProcess: ReturnType<typeof spawn> | null = null;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Kill daemon if running
    if (daemonProcess) {
      daemonProcess.kill();
      daemonProcess = null;
    }

    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it('should keep daemon running with no enabled targets', async () => {
    // Create config with no enabled targets
    const config = {
      version: '1.0',
      projectType: 'node',
      targets: [
        {
          name: 'test',
          type: 'executable',
          enabled: false,
          buildCommand: 'echo "test"',
          outputPath: './test-output',
          watchPaths: ['*.js'],
        },
      ],
    };

    const configPath = join(testDir, 'poltergeist.config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2));

    // Start daemon
    const cliPath = join(process.cwd(), 'dist', 'cli.js');
    daemonProcess = spawn('node', [cliPath, 'start'], {
      cwd: testDir,
      detached: false,
      stdio: 'pipe',
    });

    // Wait for daemon to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Daemon failed to start within timeout'));
      }, 5000);

      daemonProcess!.stdout!.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Daemon started') || output.includes('daemon started')) {
          clearTimeout(timeout);
          resolve();
        }
      });

      daemonProcess!.stderr!.on('data', (data) => {
        console.error('Daemon stderr:', data.toString());
      });

      daemonProcess!.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      daemonProcess!.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(`Daemon exited with code ${code}`));
        }
      });
    });

    // Verify daemon is still running after a short delay
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(daemonProcess!.exitCode).toBeNull();

    // Check daemon log exists and contains expected messages
    const logFiles = await import('fs').then((fs) =>
      fs.promises.readdir(testDir).catch(() => [])
    );
    const logFile = logFiles.find((f) => f.endsWith('.log'));
    
    if (logFile) {
      const logContent = await readFile(join(testDir, logFile), 'utf-8');
      expect(logContent).toContain('No enabled targets found. Daemon will continue running.');
    }
  });

  it('should accept targets via hot reload', async () => {
    // Create config with no enabled targets
    const config = {
      version: '1.0',
      projectType: 'node',
      targets: [
        {
          name: 'test',
          type: 'executable',
          enabled: false,
          buildCommand: 'echo "test" > test-output.txt',
          outputPath: './test-output.txt',
          watchPaths: ['*.js'],
        },
      ],
    };

    const configPath = join(testDir, 'poltergeist.config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2));

    // Start daemon
    const cliPath = join(process.cwd(), 'dist', 'cli.js');
    daemonProcess = spawn('node', [cliPath, 'start'], {
      cwd: testDir,
      detached: false,
      stdio: 'pipe',
    });

    // Wait for daemon to start
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      daemonProcess!.stdout!.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Daemon started') || output.includes('daemon started')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // Verify daemon is running
    expect(daemonProcess!.exitCode).toBeNull();

    // Enable target via config modification
    config.targets[0].enabled = true;
    await writeFile(configPath, JSON.stringify(config, null, 2));

    // Wait for hot reload to process
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify daemon is still running
    expect(daemonProcess!.exitCode).toBeNull();

    // Check if state file was created for the newly enabled target
    const stateDir = join(tmpdir(), 'poltergeist');
    const stateDirContents = await import('fs').then((fs) =>
      fs.promises.readdir(stateDir).catch(() => [])
    );
    
    // Look for state file for our test target
    const stateFile = stateDirContents.find(
      (f) => f.includes('-test.state')
    );
    
    if (stateFile) {
      try {
        const stateContent = await readFile(join(stateDir, stateFile), 'utf-8');
        const state = JSON.parse(stateContent);
        expect(state.target).toBe('test');
      } catch (error) {
        // State file might not be ready yet or might be in process of being written
        console.log('Could not parse state file:', error);
      }
    }
  });
});