import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWrapper } from '../src/polter.js';
import type { ExecutableTarget, PoltergeistConfig, PoltergeistState } from '../src/types.js';

describe('polter command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `polter-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Save original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Reset all mocks
    vi.clearAllMocks();

    // Mock console methods to avoid test output noise
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      // Allow debug messages through
      if (args[0]?.includes?.('Test debug') || args[0]?.includes?.('[Poltergeist]')) {
        console.info(...args); // Use console.info which won't be mocked
      }
    });
    vi.spyOn(console, 'warn').mockImplementation((...args) => {
      console.info('WARN:', ...args);
    });
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      console.info('ERROR:', ...args);
    });
  });

  afterEach(() => {
    // Restore original cwd
    process.chdir(originalCwd);

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // Restore console methods
    vi.restoreAllMocks();
  });

  describe('build status handling', () => {
    it('should execute target when build is successful', async () => {
      // Create a config file
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building"',
            outputPath: './test-app.js',
            watchPaths: ['*.js'],
          } as ExecutableTarget,
        ],
      };
      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      // Create the executable
      writeFileSync('test-app.js', '#!/usr/bin/env node\nconsole.log("Hello from test-app");');

      // Create state directory and file
      const stateDir = join(tmpdir(), 'poltergeist');
      mkdirSync(stateDir, { recursive: true });

      // Get the actual current working directory (which polter will use)
      const actualProjectRoot = process.cwd();
      const projectName = actualProjectRoot.split('/').pop() || 'unknown';
      const projectHash = require('crypto').createHash('sha256').update(actualProjectRoot).digest('hex').substring(0, 8);

      // Create a successful state file
      const state: PoltergeistState = {
        version: '1.0',
        projectPath: actualProjectRoot,
        projectName: projectName,
        target: 'test-app',
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
        lastBuild: {
          status: 'success',
          timestamp: new Date().toISOString(),
          buildTime: 1.5,
        },
      };

      const stateFile = join(
        stateDir,
        `${projectName}-${projectHash}-test-app.state`
      );
      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      // Mock process.exit to capture exit code
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      // Run polter
      try {
        await runWrapper('test-app', [], {
          timeout: 5000,
          force: false,
          noWait: false,
          verbose: true,
          showLogs: true,
          logLines: 5,
        });
      } catch (error: any) {
        // Check that it tried to execute
        expect(error.message).toContain('Process exited with code');
      }

      mockExit.mockRestore();
    });

    it('should wait for build when status is building', async () => {
      // Create a config file
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building"',
            outputPath: './test-app.js',
            watchPaths: ['*.js'],
          } as ExecutableTarget,
        ],
      };
      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      // Create the executable
      writeFileSync('test-app.js', '#!/usr/bin/env node\nconsole.log("Hello from test-app");');

      // Create state directory and file
      const stateDir = join(tmpdir(), 'poltergeist');
      mkdirSync(stateDir, { recursive: true });

      // Get the actual current working directory (which polter will use)
      const actualProjectRoot = process.cwd();
      const projectName = actualProjectRoot.split('/').pop() || 'unknown';
      const projectHash = require('crypto').createHash('sha256').update(actualProjectRoot).digest('hex').substring(0, 8);

      // Create a building state file
      const state: PoltergeistState = {
        version: '1.0',
        projectPath: actualProjectRoot,
        projectName: projectName,
        target: 'test-app',
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
        lastBuild: {
          status: 'building',
          timestamp: new Date().toISOString(),
        },
      };

      const stateFile = join(
        stateDir,
        `${projectName}-${projectHash}-test-app.state`
      );
      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      // Mock process.exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      // Set up a timer to update the state file to success after 500ms
      setTimeout(() => {
        state.lastBuild!.status = 'success';
        state.lastBuild!.buildTime = 0.5;
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
      }, 500);

      // Run polter with a short timeout
      try {
        await runWrapper('test-app', [], {
          timeout: 2000,
          force: false,
          noWait: false,
          verbose: true,
          showLogs: false,
          logLines: 5,
        });
      } catch (error: any) {
        // Should eventually succeed
        expect(error.message).toContain('Process exited with code');
      }

      mockExit.mockRestore();
    });

    it('should fail when build failed and --force is not specified', async () => {
      // Create a config file
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building"',
            outputPath: './test-app.js',
            watchPaths: ['*.js'],
          } as ExecutableTarget,
        ],
      };
      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      // Create state directory and file
      const stateDir = join(tmpdir(), 'poltergeist');
      mkdirSync(stateDir, { recursive: true });

      // Get the actual current working directory (which polter will use)
      const actualProjectRoot = process.cwd();
      const projectName = actualProjectRoot.split('/').pop() || 'unknown';
      const projectHash = require('crypto').createHash('sha256').update(actualProjectRoot).digest('hex').substring(0, 8);

      // Create a failed state file
      const state: PoltergeistState = {
        version: '1.0',
        projectPath: actualProjectRoot,
        projectName: projectName,
        target: 'test-app',
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
        lastBuild: {
          status: 'failure',
          timestamp: new Date().toISOString(),
          errorSummary: 'Build failed with errors',
        },
      };

      const stateFile = join(
        stateDir,
        `${projectName}-${projectHash}-test-app.state`
      );
      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      // Mock process.exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      // Run polter
      try {
        await runWrapper('test-app', [], {
          timeout: 5000,
          force: false,
          noWait: false,
          verbose: false,
          showLogs: true,
          logLines: 5,
        });
      } catch (error: any) {
        // Should exit with error code 1
        expect(error.message).toContain('Process exited with code 1');
      }

      mockExit.mockRestore();
    });

    it('should execute when build failed but --force is specified', async () => {
      // Create a config file
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building"',
            outputPath: './test-app.js',
            watchPaths: ['*.js'],
          } as ExecutableTarget,
        ],
      };
      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      // Create the executable
      writeFileSync('test-app.js', '#!/usr/bin/env node\nconsole.log("Hello from test-app");');

      // Create state directory and file
      const stateDir = join(tmpdir(), 'poltergeist');
      mkdirSync(stateDir, { recursive: true });

      // Get the actual current working directory (which polter will use)
      const actualProjectRoot = process.cwd();
      const projectName = actualProjectRoot.split('/').pop() || 'unknown';
      const projectHash = require('crypto').createHash('sha256').update(actualProjectRoot).digest('hex').substring(0, 8);

      // Create a failed state file
      const state: PoltergeistState = {
        version: '1.0',
        projectPath: actualProjectRoot,
        projectName: projectName,
        target: 'test-app',
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
        lastBuild: {
          status: 'failure',
          timestamp: new Date().toISOString(),
          errorSummary: 'Build failed with errors',
        },
      };

      const stateFile = join(
        stateDir,
        `${projectName}-${projectHash}-test-app.state`
      );
      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      // Mock process.exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      // Run polter with --force
      try {
        await runWrapper('test-app', [], {
          timeout: 5000,
          force: true, // Force execution despite failure
          noWait: false,
          verbose: false,
          showLogs: true,
          logLines: 5,
        });
      } catch (error: any) {
        // Should try to execute
        expect(error.message).toContain('Process exited with code');
      }

      mockExit.mockRestore();
    });
  });

  describe('fallback behavior', () => {
    it('should attempt stale execution when no config found', async () => {
      // Create an executable without config
      writeFileSync('test-app', '#!/usr/bin/env node\nconsole.log("Hello");');

      // Mock process.exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      // Run polter
      try {
        await runWrapper('test-app', [], {
          timeout: 5000,
          force: false,
          noWait: false,
          verbose: true,
          showLogs: true,
          logLines: 5,
        });
      } catch (error: any) {
        // Should attempt stale execution
        expect(error.message).toContain('Process exited with code');
      }

      // Check that warning was shown
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('No poltergeist.config.json found')
      );

      mockExit.mockRestore();
    });

    it('should attempt stale execution when target not in config', async () => {
      // Create a config file without the target
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'other-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building"',
            outputPath: './other-app.js',
            watchPaths: ['*.js'],
          } as ExecutableTarget,
        ],
      };
      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      // Create an executable
      writeFileSync('test-app', '#!/usr/bin/env node\nconsole.log("Hello");');

      // Mock process.exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      // Run polter
      try {
        await runWrapper('test-app', [], {
          timeout: 5000,
          force: false,
          noWait: false,
          verbose: true,
          showLogs: true,
          logLines: 5,
        });
      } catch (error: any) {
        // Should attempt stale execution
        expect(error.message).toContain('Process exited with code');
      }

      // Check that warning was shown
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Target 'test-app' not found in config")
      );

      mockExit.mockRestore();
    });

    it('should show warning when Poltergeist is not running', async () => {
      // Create a config file
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building"',
            outputPath: './test-app.js',
            watchPaths: ['*.js'],
          } as ExecutableTarget,
        ],
      };
      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      // Create the executable
      writeFileSync('test-app.js', '#!/usr/bin/env node\nconsole.log("Hello from test-app");');

      // Create state directory and file with old heartbeat (Poltergeist not running)
      const stateDir = join(tmpdir(), 'poltergeist');
      mkdirSync(stateDir, { recursive: true });

      // Get the actual current working directory (which polter will use)
      const actualProjectRoot = process.cwd();
      const projectName = actualProjectRoot.split('/').pop() || 'unknown';
      const projectHash = require('crypto').createHash('sha256').update(actualProjectRoot).digest('hex').substring(0, 8);

      const state: PoltergeistState = {
        version: '1.0',
        projectPath: actualProjectRoot,
        projectName: projectName,
        target: 'test-app',
        process: {
          pid: 99999, // Non-existent PID
          isActive: false,
          startTime: new Date(Date.now() - 60000).toISOString(),
          lastHeartbeat: new Date(Date.now() - 60000).toISOString(), // Old heartbeat
        },
        lastBuild: {
          status: 'success',
          timestamp: new Date().toISOString(),
          buildTime: 1.5,
        },
      };

      const stateFile = join(
        stateDir,
        `${projectName}-${projectHash}-test-app.state`
      );
      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      // Mock process.exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      // Run polter
      try {
        await runWrapper('test-app', [], {
          timeout: 5000,
          force: false,
          noWait: false,
          verbose: false,
          showLogs: true,
          logLines: 5,
        });
      } catch (error: any) {
        // Should execute with warning
        expect(error.message).toContain('Process exited with code');
      }

      // Check that warning was shown
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Executing potentially stale binary')
      );

      mockExit.mockRestore();
    });
  });

  describe('timeout handling', () => {
    it('should respect --timeout option', async () => {
      // Create a config file
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building"',
            outputPath: './test-app.js',
            watchPaths: ['*.js'],
          } as ExecutableTarget,
        ],
      };
      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      // Create state directory and file
      const stateDir = join(tmpdir(), 'poltergeist');
      mkdirSync(stateDir, { recursive: true });

      // Get the actual current working directory (which polter will use)
      const actualProjectRoot = process.cwd();
      
      // Calculate the correct project name and hash for state file using the actual cwd
      const projectName = actualProjectRoot.split('/').pop() || 'unknown';
      const projectHash = require('crypto').createHash('sha256').update(actualProjectRoot).digest('hex').substring(0, 8);

      // Create a building state file that won't complete
      const state: PoltergeistState = {
        version: '1.0',
        projectPath: actualProjectRoot,
        projectName: projectName,
        target: 'test-app',
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
        lastBuild: {
          status: 'building',
          timestamp: new Date().toISOString(),
        },
      };

      const stateFile = join(
        stateDir,
        `${projectName}-${projectHash}-test-app.state`
      );
      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      // Mock process.exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      const startTime = Date.now();

      // Run polter with short timeout
      try {
        await runWrapper('test-app', [], {
          timeout: 1000, // 1 second timeout
          force: false,
          noWait: false,
          verbose: false,
          showLogs: false,
          logLines: 5,
        });
      } catch (error: any) {
        // Should timeout
        const elapsed = Date.now() - startTime;
        
        expect(elapsed).toBeGreaterThanOrEqual(900); // Allow some margin
        expect(elapsed).toBeLessThan(2000);
        expect(error.message).toContain('Process exited with code 1');
      }

      // Check that timeout error was shown
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Build timeout after 1000ms')
      );

      mockExit.mockRestore();
    });

    it('should fail immediately with --no-wait when building', async () => {
      // Create a config file
      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'test-app',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo "Building"',
            outputPath: './test-app.js',
            watchPaths: ['*.js'],
          } as ExecutableTarget,
        ],
      };
      writeFileSync('poltergeist.config.json', JSON.stringify(config, null, 2));

      // Create state directory and file
      const stateDir = join(tmpdir(), 'poltergeist');
      mkdirSync(stateDir, { recursive: true });

      // Get the actual current working directory (which polter will use)
      const actualProjectRoot = process.cwd();
      const projectName = actualProjectRoot.split('/').pop() || 'unknown';
      const projectHash = require('crypto').createHash('sha256').update(actualProjectRoot).digest('hex').substring(0, 8);

      // Create a building state file
      const state: PoltergeistState = {
        version: '1.0',
        projectPath: actualProjectRoot,
        projectName: projectName,
        target: 'test-app',
        process: {
          pid: process.pid,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
        lastBuild: {
          status: 'building',
          timestamp: new Date().toISOString(),
        },
      };

      const stateFile = join(
        stateDir,
        `${projectName}-${projectHash}-test-app.state`
      );
      writeFileSync(stateFile, JSON.stringify(state, null, 2));

      // Mock process.exit
      const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exited with code ${code}`);
      });

      const startTime = Date.now();

      // Run polter with --no-wait
      try {
        await runWrapper('test-app', [], {
          timeout: 5000,
          force: false,
          noWait: true, // Don't wait for build
          verbose: false,
          showLogs: false,
          logLines: 5,
        });
      } catch (error: any) {
        // Should fail immediately
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeLessThan(500); // Should be immediate
        expect(error.message).toContain('Process exited with code 1');
      }

      // Check that appropriate error was shown
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Build in progress and --no-wait specified')
      );

      mockExit.mockRestore();
    });
  });
});
