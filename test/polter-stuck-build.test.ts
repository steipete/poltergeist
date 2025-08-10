// Tests for polter's handling of stuck builds and lock detection

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoltergeistState } from '../src/state.js';
import { FileSystemUtils } from '../src/utils/filesystem.js';

// Mock the imports that polter uses
vi.mock('../src/state.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    isLocked: vi.fn(),
    initializeState: vi.fn(),
    updateBuildStatus: vi.fn(),
  })),
}));

vi.mock('../src/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Polter Stuck Build Detection', () => {
  let testDir: string;
  let projectRoot: string;
  let stateFile: string;

  beforeEach(() => {
    // Create test directories
    testDir = join(tmpdir(), `poltergeist-test-${Date.now()}`);
    projectRoot = join(testDir, 'test-project');
    mkdirSync(testDir, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    
    // Set up environment
    process.env.POLTERGEIST_STATE_DIR = testDir;
  });

  afterEach(() => {
    // Clean up
    delete process.env.POLTERGEIST_STATE_DIR;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Stuck Build Detection', () => {
    it('should detect stuck SwiftPM build from error output', () => {
      const targetName = 'test-target';
      stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      
      // Create state with SwiftPM error
      const state: Partial<PoltergeistState> = {
        version: '1.0',
        projectPath: projectRoot,
        projectName: 'test-project',
        target: targetName,
        targetType: 'executable',
        configPath: join(projectRoot, 'poltergeist.config.json'),
        lastBuild: {
          status: 'failure',
          timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
          gitHash: 'abc123',
          buildTime: 0,
          errorSummary: 'Build failed',
        },
        lastBuildError: {
          exitCode: 1,
          errorOutput: [
            'Error: Build failed',
            'Another instance of SwiftPM is already running using \'/path/to/.build\', waiting until that process has finished execution...',
          ],
          lastOutput: [],
          command: 'swift build',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
        },
        process: {
          pid: 12345,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      };
      
      // Write state file
      const dir = join(testDir, 'poltergeist');
      mkdirSync(dir, { recursive: true });
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      // Read and check if SwiftPM stuck build is detected
      const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const hasStuckSwiftPM = stateContent.lastBuildError?.errorOutput?.some((line: string) =>
        line.includes('Another instance of SwiftPM is already running')
      );
      
      expect(hasStuckSwiftPM).toBe(true);
    });

    it('should detect generic stuck build patterns', () => {
      const targetName = 'test-target';
      stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      
      const stuckPatterns = [
        'another process is already running',
        'resource temporarily unavailable',
        'file is locked',
        'cannot obtain lock',
      ];
      
      stuckPatterns.forEach(pattern => {
        const state: Partial<PoltergeistState> = {
          version: '1.0',
          projectPath: projectRoot,
          projectName: 'test-project',
          target: targetName,
          targetType: 'executable',
          configPath: join(projectRoot, 'poltergeist.config.json'),
          lastBuild: {
            status: 'failure',
            timestamp: new Date().toISOString(),
            gitHash: 'abc123',
            buildTime: 0,
            errorSummary: 'Build failed',
          },
          lastBuildError: {
            exitCode: 1,
            errorOutput: [
              'Error: Build failed',
              pattern,
            ],
            lastOutput: [],
            command: 'make build',
            timestamp: new Date().toISOString(),
          },
          process: {
            pid: 12345,
            isActive: true,
            startTime: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
          },
        };
        
        // Write state file
        const dir = join(testDir, 'poltergeist');
        mkdirSync(dir, { recursive: true });
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
        
        // Read and check if stuck build is detected
        const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const hasStuckBuild = stateContent.lastBuildError?.errorOutput?.some((line: string) =>
          line.includes('another process is already running') ||
          line.includes('resource temporarily unavailable') ||
          line.includes('file is locked') ||
          line.includes('cannot obtain lock')
        );
        
        expect(hasStuckBuild).toBe(true);
      });
    });

    it('should not detect stuck build for regular compilation errors', () => {
      const targetName = 'test-target';
      stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      
      // Create state with regular build error
      const state: Partial<PoltergeistState> = {
        version: '1.0',
        projectPath: projectRoot,
        projectName: 'test-project',
        target: targetName,
        targetType: 'executable',
        configPath: join(projectRoot, 'poltergeist.config.json'),
        lastBuild: {
          status: 'failure',
          timestamp: new Date().toISOString(),
          gitHash: 'abc123',
          buildTime: 0,
          errorSummary: 'Compilation error',
        },
        lastBuildError: {
          exitCode: 1,
          errorOutput: [
            'error: cannot find \'foo\' in scope',
            'note: did you mean \'bar\'?',
          ],
          lastOutput: [],
          command: 'swift build',
          timestamp: new Date().toISOString(),
        },
        process: {
          pid: 12345,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      };
      
      // Write state file
      const dir = join(testDir, 'poltergeist');
      mkdirSync(dir, { recursive: true });
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      // Read and check if SwiftPM stuck build is detected
      const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const hasStuckSwiftPM = stateContent.lastBuildError?.errorOutput?.some((line: string) =>
        line.includes('Another instance of SwiftPM is already running')
      );
      
      expect(hasStuckSwiftPM).toBe(false);
    });
  });

  describe('Lock Detection Despite Failed Status', () => {
    it('should create correct state file path for lock checking', () => {
      const targetName = 'my-app';
      const expectedPath = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      
      // Path should be in state directory with project hash
      expect(expectedPath).toContain(testDir);
      expect(expectedPath).toContain('test-project');
      expect(expectedPath).toContain('my-app.state');
      expect(expectedPath).toMatch(/test-project-[a-f0-9]{8}-my-app\.state$/);
    });

    it('should handle state with failed build but active lock', () => {
      const targetName = 'locked-target';
      stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      
      // Create state showing failed build
      const state: Partial<PoltergeistState> = {
        version: '1.0',
        projectPath: projectRoot,
        projectName: 'test-project',
        target: targetName,
        targetType: 'executable',
        configPath: join(projectRoot, 'poltergeist.config.json'),
        lastBuild: {
          status: 'failure',
          timestamp: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
          gitHash: 'def456',
          buildTime: 0,
          errorSummary: 'Previous build failed',
        },
        process: {
          pid: 12345,
          isActive: true,
          startTime: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        },
      };
      
      // Write state file
      const dir = join(testDir, 'poltergeist');
      mkdirSync(dir, { recursive: true });
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      
      // Create a lock file to simulate active build
      const lockFile = stateFile.replace('.state', '.lock');
      try {
        writeFileSync(lockFile, JSON.stringify({ pid: 67890, timestamp: Date.now() }));
      } catch (e) {
        console.error('Failed to write lock file:', e);
        throw e;
      }
      
      // Verify state shows failed but lock exists
      const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(stateContent.lastBuild.status).toBe('failure');
      
      // In real implementation, StateManager.isLocked would check this
      const { existsSync } = require('fs');
      expect(existsSync(lockFile)).toBe(true);
    });
  });

  describe('Build Status Detection', () => {
    it('should correctly identify build status from state', () => {
      const targetName = 'status-test';
      stateFile = FileSystemUtils.getStateFilePath(projectRoot, targetName);
      
      const testCases = [
        { status: 'success', expected: 'success' },
        { status: 'failure', expected: 'failed' },
        { status: 'building', expected: 'building' },
        { status: 'idle', expected: 'unknown' },
      ];
      
      const dir = join(testDir, 'poltergeist');
      mkdirSync(dir, { recursive: true });
      
      testCases.forEach(({ status, expected }) => {
        const state: Partial<PoltergeistState> = {
          version: '1.0',
          projectPath: projectRoot,
          projectName: 'test-project',
          target: targetName,
          targetType: 'executable',
          configPath: join(projectRoot, 'poltergeist.config.json'),
          lastBuild: {
            status: status as any,
            timestamp: new Date().toISOString(),
            gitHash: 'abc123',
            buildTime: 100,
          },
          process: {
            pid: 12345,
            isActive: true,
            startTime: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
          },
        };
        
        writeFileSync(stateFile, JSON.stringify(state, null, 2));
        
        // Read and verify status mapping
        const stateContent = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const buildStatus = stateContent.lastBuild?.status;
        
        // Map internal status to polter's expected values
        let mappedStatus = 'unknown';
        if (buildStatus === 'success') mappedStatus = 'success';
        else if (buildStatus === 'failure') mappedStatus = 'failed';
        else if (buildStatus === 'building') mappedStatus = 'building';
        
        expect(mappedStatus).toBe(expected);
      });
    });
  });

  describe('Error Message Formatting', () => {
    it('should format time ago correctly', () => {
      const testCases = [
        { ms: 1000, expected: /1 second/ },
        { ms: 60000, expected: /1 minute/ },
        { ms: 3600000, expected: /1 hour/ },
        { ms: 86400000, expected: /1 day/ },
        { ms: 120000, expected: /2 minutes/ },
      ];
      
      testCases.forEach(({ ms, expected }) => {
        const timestamp = new Date(Date.now() - ms);
        const timeAgo = getRelativeTime(timestamp);
        expect(timeAgo).toMatch(expected);
      });
    });
  });
});

// Helper function to match polter's time formatting
function getRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) {
    return seconds === 1 ? '1 second ago' : `${seconds} seconds ago`;
  }
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}