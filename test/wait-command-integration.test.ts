// Integration tests for the wait command's polling behavior

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoltergeistConfig } from '../src/types.js';

// Mock modules
vi.mock('fs');
vi.mock('../src/factories.js');
vi.mock('../src/logger.js');
vi.mock('../src/utils/config-manager.js');

// Import after mocking
import { existsSync, readFileSync } from 'fs';
import { program } from '../src/cli.js';
import { createPoltergeist } from '../src/factories.js';
import { createLogger } from '../src/logger.js';
import { ConfigurationManager } from '../src/utils/config-manager.js';

describe('Wait Command Integration', () => {
  let mockPoltergeist: any;
  let consoleLogSpy: any;
  let processExitSpy: any;
  let originalTTY: boolean | undefined;

  const mockConfig: PoltergeistConfig = {
    version: '1.0',
    projectType: 'node',
    targets: [
      {
        name: 'test-app',
        type: 'executable',
        buildCommand: 'npm run build',
        outputPath: './dist/app.js',
        watchPaths: ['src/**/*.ts'],
        enabled: true,
      },
    ],
  };

  beforeEach(() => {
    originalTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));
    vi.mocked(ConfigurationManager.getConfig).mockResolvedValue({
      config: mockConfig,
      projectRoot: '/test/project',
      configPath: '/test/project/poltergeist.config.json',
    });
    vi.mocked(createLogger).mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any);

    mockPoltergeist = {
      getStatus: vi.fn(),
    };
    vi.mocked(createPoltergeist).mockReturnValue(mockPoltergeist);
  });

  afterEach(() => {
    if (originalTTY !== undefined) {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalTTY,
        writable: true,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
  });

  it('polls until build completes successfully', async () => {
    const buildStart = new Date().toISOString();
    let callCount = 0;

    // Mock progressive status updates
    mockPoltergeist.getStatus.mockImplementation(async (targetName?: string) => {
      callCount++;
      
      // For initial status check (no target specified)
      if (!targetName) {
        return {
          'test-app': {
            lastBuild: {
              status: 'building',
              timestamp: buildStart,
            },
            buildCommand: 'npm run build',
          },
        };
      }
      
      // For targeted polling
      if (callCount <= 3) {
        // First few calls: still building
        return {
          'test-app': {
            lastBuild: {
              status: 'building',
              timestamp: buildStart,
            },
            buildCommand: 'npm run build',
          },
        };
      } else {
        // Final call: build complete
        return {
          'test-app': {
            lastBuild: {
              status: 'success',
              timestamp: buildStart,
              duration: 2500,
            },
          },
        };
      }
    });

    try {
      await program.parseAsync(['node', 'cli.js', 'wait', 'test-app', '--timeout', '5']);
    } catch (error) {
      // Expected due to process.exit
    }

    // Should have called getStatus multiple times
    expect(mockPoltergeist.getStatus.mock.calls.length).toBeGreaterThan(2);
    
    // Should have called with target name for polling
    const targetedCalls = mockPoltergeist.getStatus.mock.calls.filter((call: any[]) => call[0] === 'test-app');
    expect(targetedCalls.length).toBeGreaterThan(0);
    
    const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
    expect(output).toContain('✅ Build completed successfully');
  });

  it('stops polling and reports failure when build fails', async () => {
    const buildStart = new Date().toISOString();
    let callCount = 0;

    mockPoltergeist.getStatus.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          'test-app': {
            lastBuild: {
              status: 'building',
              timestamp: buildStart,
            },
            buildCommand: 'npm run build',
          },
        };
      } else {
        return {
          'test-app': {
            lastBuild: {
              status: 'failure',
              timestamp: buildStart,
              errorSummary: 'TypeScript compilation failed',
            },
          },
        };
      }
    });

    let exitCode: number | undefined;
    processExitSpy.mockImplementation((code?: string | number) => {
      exitCode = typeof code === 'number' ? code : parseInt(code || '0');
      throw new Error('process.exit');
    });

    try {
      await program.parseAsync(['node', 'cli.js', 'wait', 'test-app']);
    } catch (error) {
      // Expected
    }

    expect(exitCode).toBe(1);
    expect(mockPoltergeist.getStatus).toHaveBeenCalledTimes(2);
    const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
    expect(output).toContain('❌ Build failed');
    expect(output).toContain('TypeScript compilation failed');
  });

  it('respects timeout option', async () => {
    const buildStart = new Date().toISOString();

    // Always return building status
    mockPoltergeist.getStatus.mockResolvedValue({
      'test-app': {
        lastBuild: {
          status: 'building',
          timestamp: buildStart,
        },
        buildCommand: 'npm run build',
      },
    });

    let exitCode: number | undefined;
    processExitSpy.mockImplementation((code?: string | number) => {
      exitCode = typeof code === 'number' ? code : parseInt(code || '0');
      throw new Error('process.exit');
    });

    // Use a very short timeout
    const startTime = Date.now();
    try {
      await program.parseAsync(['node', 'cli.js', 'wait', 'test-app', '--timeout', '2']);
    } catch (error) {
      // Expected
    }
    const elapsed = Date.now() - startTime;

    expect(exitCode).toBe(1);
    expect(elapsed).toBeLessThan(3000); // Should timeout around 2 seconds
    const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
    expect(output).toContain('❌ Build failed');
    expect(output).toContain('Timeout exceeded');
  });

  it('handles target disappearing during wait', async () => {
    let callCount = 0;

    mockPoltergeist.getStatus.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          'test-app': {
            lastBuild: {
              status: 'building',
              timestamp: new Date().toISOString(),
            },
            buildCommand: 'npm run build',
          },
        };
      } else {
        // Target disappeared
        return {};
      }
    });

    let exitCode: number | undefined;
    processExitSpy.mockImplementation((code?: string | number) => {
      exitCode = typeof code === 'number' ? code : parseInt(code || '0');
      throw new Error('process.exit');
    });

    try {
      await program.parseAsync(['node', 'cli.js', 'wait', 'test-app']);
    } catch (error) {
      // Expected
    }

    expect(exitCode).toBe(1);
    const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
    expect(output).toContain('❌ Build failed');
    expect(output).toContain('Target disappeared');
  });

  it('handles unexpected build status transitions', async () => {
    let callCount = 0;

    mockPoltergeist.getStatus.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          'test-app': {
            lastBuild: {
              status: 'building',
              timestamp: new Date().toISOString(),
            },
            buildCommand: 'npm run build',
          },
        };
      } else {
        // Unexpected transition to idle
        return {
          'test-app': {
            lastBuild: {
              status: 'idle',
              timestamp: new Date().toISOString(),
            },
          },
        };
      }
    });

    let exitCode: number | undefined;
    processExitSpy.mockImplementation((code?: string | number) => {
      exitCode = typeof code === 'number' ? code : parseInt(code || '0');
      throw new Error('process.exit');
    });

    try {
      await program.parseAsync(['node', 'cli.js', 'wait', 'test-app']);
    } catch (error) {
      // Expected
    }

    expect(exitCode).toBe(1);
    const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
    expect(output).toContain('❌ Build failed');
    expect(output).toContain('Build ended with status: idle');
  });
});