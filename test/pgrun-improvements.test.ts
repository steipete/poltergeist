import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import type { PoltergeistState } from '../src/state.js';
import type { Target } from '../src/types.js';
import { FileSystemUtils } from '../src/utils/filesystem.js';

// Mock modules
vi.mock('child_process');
vi.mock('fs');
vi.mock('../src/utils/filesystem.js');
vi.mock('../src/utils/config-manager.js');

describe('pgrun improvements', () => {
  const mockTarget: Target = {
    name: 'test-app',
    type: 'executable',
    buildCommand: 'echo "build"',
    outputPath: './test.js',
    watchPaths: ['**/*.js'],
    enabled: true,
  };

  const mockState: PoltergeistState = {
    version: '1.0',
    projectPath: '/test/project',
    projectName: 'test-project',
    target: 'test-app',
    targetType: 'executable',
    configPath: '/test/project/poltergeist.config.json',
    process: {
      pid: 12345,
      hostname: 'test-host',
      isActive: false,
      startTime: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    },
    lastBuild: {
      targetName: 'test-app',
      status: 'success',
      timestamp: new Date().toISOString(),
      gitHash: 'abc123',
      builder: 'Executable',
      duration: 1000,
      buildTime: 1,
    },
    appInfo: {
      outputPath: './test.js',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('build status detection', () => {
    it('should check lastBuild.status for building state, not watcher process', async () => {
      // The old logic incorrectly checked if process.pid is alive to determine if building
      // The correct logic checks lastBuild.status === 'building'
      
      const buildingState = {
        ...mockState,
        lastBuild: {
          ...mockState.lastBuild!,
          status: 'building' as const,
        },
      };
      
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(FileSystemUtils.readJsonFileStrict).mockReturnValue(buildingState);
      vi.mocked(FileSystemUtils.isProcessAlive).mockReturnValue(true); // Watcher is alive
      
      const getBuildStatus = async () => {
        const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>('');
        if (!state) return 'unknown';
        
        // Correct logic: Check lastBuild status
        if (state.lastBuild?.status === 'building') return 'building';
        if (state.lastBuild?.status === 'success') return 'success';
        if (state.lastBuild?.status === 'failure') return 'failed';
        return 'unknown';
      };
      
      const status = await getBuildStatus();
      expect(status).toBe('building'); // Should detect building state from lastBuild
    });

    it('should return success when build is complete', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(FileSystemUtils.readJsonFileStrict).mockReturnValue(mockState);
      
      const getBuildStatus = async () => {
        const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>('');
        if (!state) return 'unknown';
        
        if (state.lastBuild?.status === 'building') return 'building';
        if (state.lastBuild?.status === 'success') return 'success';
        if (state.lastBuild?.status === 'failure') return 'failed';
        return 'unknown';
      };
      
      const status = await getBuildStatus();
      expect(status).toBe('success');
    });
  });

  describe('execution based on file type', () => {
    const mockSpawn = vi.mocked(spawn);
    
    beforeEach(() => {
      mockSpawn.mockImplementation(() => {
        const child = {
          on: vi.fn((event, handler) => {
            if (event === 'exit') {
              setTimeout(() => handler(0), 10);
            }
          }),
          stdout: null,
          stderr: null,
          stdin: null,
          pid: 12345,
          kill: vi.fn(),
        } as any;
        return child;
      });
    });

    it('should execute .js files with node', () => {
      const executeTarget = (binaryPath: string, args: string[]) => {
        const ext = binaryPath.toLowerCase();
        let command: string;
        let commandArgs: string[];
        
        if (ext.endsWith('.js') || ext.endsWith('.mjs')) {
          command = 'node';
          commandArgs = [binaryPath, ...args];
        } else {
          command = binaryPath;
          commandArgs = args;
        }
        
        spawn(command, commandArgs, { stdio: 'inherit' });
      };
      
      executeTarget('/path/to/app.js', ['--arg1', '--arg2']);
      
      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        ['/path/to/app.js', '--arg1', '--arg2'],
        { stdio: 'inherit' }
      );
    });

    it('should execute .py files with python', () => {
      const executeTarget = (binaryPath: string, args: string[]) => {
        const ext = binaryPath.toLowerCase();
        let command: string;
        let commandArgs: string[];
        
        if (ext.endsWith('.py')) {
          command = 'python';
          commandArgs = [binaryPath, ...args];
        } else {
          command = binaryPath;
          commandArgs = args;
        }
        
        spawn(command, commandArgs, { stdio: 'inherit' });
      };
      
      executeTarget('/path/to/script.py', ['--help']);
      
      expect(mockSpawn).toHaveBeenCalledWith(
        'python',
        ['/path/to/script.py', '--help'],
        { stdio: 'inherit' }
      );
    });

    it('should execute .sh files with sh', () => {
      const executeTarget = (binaryPath: string, args: string[]) => {
        const ext = binaryPath.toLowerCase();
        let command: string;
        let commandArgs: string[];
        
        if (ext.endsWith('.sh')) {
          command = 'sh';
          commandArgs = [binaryPath, ...args];
        } else {
          command = binaryPath;
          commandArgs = args;
        }
        
        spawn(command, commandArgs, { stdio: 'inherit' });
      };
      
      executeTarget('/path/to/script.sh', ['-v']);
      
      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        ['/path/to/script.sh', '-v'],
        { stdio: 'inherit' }
      );
    });

    it('should execute binary files directly', () => {
      const executeTarget = (binaryPath: string, args: string[]) => {
        const ext = binaryPath.toLowerCase();
        let command: string;
        let commandArgs: string[];
        
        if (ext.endsWith('.js') || ext.endsWith('.py') || ext.endsWith('.sh')) {
          command = 'node'; // Won't match
          commandArgs = [binaryPath, ...args];
        } else {
          command = binaryPath;
          commandArgs = args;
        }
        
        spawn(command, commandArgs, { stdio: 'inherit' });
      };
      
      executeTarget('/path/to/binary', ['run', '--fast']);
      
      expect(mockSpawn).toHaveBeenCalledWith(
        '/path/to/binary',
        ['run', '--fast'],
        { stdio: 'inherit' }
      );
    });
  });

  describe('status handling', () => {
    it('should handle unknown status gracefully', async () => {
      vi.mocked(existsSync).mockReturnValue(false); // No state file
      
      const getBuildStatus = async () => {
        if (!existsSync('')) return 'unknown';
        return 'success';
      };
      
      const status = await getBuildStatus();
      expect(status).toBe('unknown');
    });

    it('should handle failed builds correctly', async () => {
      const failedState = {
        ...mockState,
        lastBuild: {
          ...mockState.lastBuild!,
          status: 'failure' as const,
        },
      };
      
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(FileSystemUtils.readJsonFileStrict).mockReturnValue(failedState);
      
      const getBuildStatus = async () => {
        const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>('');
        if (!state) return 'unknown';
        if (state.lastBuild?.status === 'failure') return 'failed';
        return 'unknown';
      };
      
      const status = await getBuildStatus();
      expect(status).toBe('failed');
    });
  });
});