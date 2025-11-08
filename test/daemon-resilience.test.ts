import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonManager } from '../src/daemon/daemon-manager.js';
import { createLogger } from '../src/logger.js';
import type { PoltergeistConfig } from '../src/types.js';

// Mock child_process module
vi.mock('child_process', () => ({
  fork: vi.fn(),
}));

// Mock ProcessManager
vi.mock('../src/utils/process-manager.js', () => ({
  ProcessManager: {
    isProcessAlive: vi.fn(),
  },
}));

// Import after mocking
import { fork } from 'child_process';
import { ProcessManager } from '../src/utils/process-manager.js';

const mockFork = fork as unknown as ReturnType<typeof vi.fn>;
const mockIsProcessAlive = ProcessManager.isProcessAlive as unknown as ReturnType<typeof vi.fn>;

const skipLongRuns =
  process.env.CI === 'true' || process.env.POLTERGEIST_COVERAGE_MODE === 'true';

describe.skipIf(skipLongRuns)('daemon resilience', () => {
  let testDir: string;
  let daemonManager: DaemonManager;
  let logger: ReturnType<typeof createLogger>;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `daemon-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create logger
    logger = createLogger(join(testDir, 'test.log'), 'error');

    // Create daemon manager
    daemonManager = new DaemonManager(logger);

    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Restore all mocks first
    vi.restoreAllMocks();

    // Clean up test directory with retry for Windows
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch (error: any) {
        // On Windows, sometimes files are still locked - wait and retry
        if (error.code === 'ENOTEMPTY' || error.code === 'EBUSY') {
          await new Promise((resolve) => setTimeout(resolve, 100));
          try {
            rmSync(testDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          } catch {
            // Ignore cleanup errors - test directory will be cleaned on next run
          }
        }
      }
    }
  });

  describe('timeout configuration', () => {
    it('should use default timeout of 30 seconds', async () => {
      vi.useFakeTimers();

      // Mock fork to simulate slow daemon startup
      const mockChild = {
        once: vi.fn(),
        unref: vi.fn(),
        disconnect: vi.fn(),
        kill: vi.fn(),
      };

      mockFork.mockReturnValue(mockChild as any);

      // Set up the mock to not send a message (simulating timeout)
      mockChild.once.mockImplementation((event, _callback) => {
        if (event === 'message') {
          // Don't call the callback to simulate timeout
        }
      });

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Start the daemon (non-blocking promise)
      const daemonPromise = daemonManager.startDaemonWithRetry(
        config,
        {
          projectRoot: testDir,
        },
        1
      ); // Only 1 retry to speed up test

      // Advance timers by 30 seconds
      await vi.advanceTimersByTimeAsync(30000);

      // Should timeout after 30 seconds
      await expect(daemonPromise).rejects.toThrow(/Daemon startup timeout after 30000ms/);

      vi.useRealTimers();
    });

    it('should respect POLTERGEIST_DAEMON_TIMEOUT environment variable', async () => {
      // Set custom timeout
      process.env.POLTERGEIST_DAEMON_TIMEOUT = '5000';

      // Mock fork to simulate slow daemon startup
      const mockChild = {
        once: vi.fn(),
        unref: vi.fn(),
        disconnect: vi.fn(),
        kill: vi.fn(),
      };

      mockFork.mockReturnValue(mockChild as any);

      // Set up the mock to not send a message (simulating timeout)
      mockChild.once.mockImplementation((event, _callback) => {
        if (event === 'message') {
          // Don't call the callback to simulate timeout
        }
      });

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      const startTime = Date.now();

      // Should timeout after 5 seconds (custom timeout)
      await expect(
        daemonManager.startDaemonWithRetry(
          config,
          {
            projectRoot: testDir,
          },
          1
        ) // Only 1 retry to speed up test
      ).rejects.toThrow(/Daemon startup timeout after 5000ms/);

      const elapsed = Date.now() - startTime;

      // Should have taken at least 5 seconds but less than 10
      expect(elapsed).toBeGreaterThanOrEqual(4500);
      expect(elapsed).toBeLessThan(10000);

      // Clean up environment variable
      delete process.env.POLTERGEIST_DAEMON_TIMEOUT;
    }, 15000); // Increase test timeout
  });

  describe('retry logic', () => {
    it('should retry daemon startup on failure', async () => {
      let attemptCount = 0;

      // Mock fork to simulate failures then success
      mockFork.mockImplementation(() => {
        attemptCount++;

        const mockChild = {
          once: vi.fn(),
          unref: vi.fn(),
          disconnect: vi.fn(),
          kill: vi.fn(),
        };

        mockChild.once.mockImplementation((event, callback) => {
          if (event === 'message') {
            setTimeout(() => {
              if (attemptCount < 3) {
                // Fail first 2 attempts
                callback({ type: 'error', error: 'Startup failed' });
              } else {
                // Succeed on 3rd attempt
                callback({ type: 'started', pid: 12345 });
              }
            }, 100);
          }
        });

        return mockChild as any;
      });

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Should succeed after retries
      const pid = await daemonManager.startDaemonWithRetry(config, {
        projectRoot: testDir,
      });

      expect(pid).toBe(12345);
      expect(attemptCount).toBe(3);
    });

    it('should use exponential backoff between retries', async () => {
      let attemptCount = 0;
      const attemptTimes: number[] = [];

      // Mock fork to simulate all failures
      mockFork.mockImplementation(() => {
        attemptCount++;
        attemptTimes.push(Date.now());

        const mockChild = {
          once: vi.fn(),
          unref: vi.fn(),
          disconnect: vi.fn(),
          kill: vi.fn(),
        };

        mockChild.once.mockImplementation((event, callback) => {
          if (event === 'message') {
            setTimeout(() => {
              callback({ type: 'error', error: 'Startup failed' });
            }, 50);
          }
        });

        return mockChild as any;
      });

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Should fail after all retries
      await expect(
        daemonManager.startDaemonWithRetry(
          config,
          {
            projectRoot: testDir,
          },
          3
        )
      ).rejects.toThrow(/Failed to start daemon after 3 attempts/);

      expect(attemptCount).toBe(3);

      // Check exponential backoff timing
      // First retry after ~1 second
      const firstDelay = attemptTimes[1] - attemptTimes[0];
      expect(firstDelay).toBeGreaterThanOrEqual(1000);
      expect(firstDelay).toBeLessThan(1500);

      // Second retry after ~2 seconds
      const secondDelay = attemptTimes[2] - attemptTimes[1];
      expect(secondDelay).toBeGreaterThanOrEqual(2000);
      expect(secondDelay).toBeLessThan(2500);
    }, 10000); // Increase test timeout
  });

  describe('concurrent startup handling', () => {
    it('should prevent concurrent daemon startups', async () => {
      // Mock fork to simulate successful startup
      const mockChild = {
        once: vi.fn(),
        unref: vi.fn(),
        disconnect: vi.fn(),
        kill: vi.fn(),
      };

      mockFork.mockReturnValue(mockChild as any);

      const messageCallbacks: any[] = [];
      mockChild.once.mockImplementation((event, callback) => {
        if (event === 'message') {
          messageCallbacks.push(callback);
        }
      });

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Start first daemon (don't await yet)
      const firstPromise = daemonManager.startDaemonWithRetry(config, {
        projectRoot: testDir,
      });

      // Wait a bit and complete the first startup
      await new Promise((resolve) => setTimeout(resolve, 100));
      messageCallbacks[0]({ type: 'started', pid: 12345 });

      // Wait for first to complete
      const firstPid = await firstPromise;
      expect(firstPid).toBe(12345);

      // Mock process as alive for the second startup attempt
      mockIsProcessAlive.mockReturnValue(true);

      // Try to start second daemon (should fail because one is already running)
      await expect(
        daemonManager.startDaemonWithRetry(config, {
          projectRoot: testDir,
        })
      ).rejects.toThrow(/Daemon already running for this project/);
    }, 10000); // Increase timeout for this test
  });

  describe('error handling', () => {
    it('should handle fork errors gracefully', async () => {
      // Mock fork to throw an error
      mockFork.mockImplementation(() => {
        throw new Error('Fork failed: ENOMEM');
      });

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Should handle the error and retry
      await expect(
        daemonManager.startDaemonWithRetry(
          config,
          {
            projectRoot: testDir,
          },
          2
        )
      ).rejects.toThrow(/Failed to start daemon after 2 attempts.*Fork failed: ENOMEM/);
    }, 10000);

    it('should handle daemon crash during startup', async () => {
      // Mock fork to simulate crash
      mockFork.mockImplementation(() => {
        const mockChild = {
          once: vi.fn(),
          unref: vi.fn(),
          disconnect: vi.fn(),
          kill: vi.fn(),
        };

        const errorCallbacks: any[] = [];
        mockChild.once.mockImplementation((event, callback) => {
          if (event === 'error') {
            errorCallbacks.push(callback);
            // Simulate crash after a delay
            setTimeout(() => {
              callback(new Error('Daemon crashed'));
            }, 100);
          }
        });

        return mockChild as any;
      });

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Should handle the crash and retry
      await expect(
        daemonManager.startDaemonWithRetry(
          config,
          {
            projectRoot: testDir,
          },
          1
        )
      ).rejects.toThrow(/Failed to start daemon after 1 attempts/);
    });

    it('should provide helpful error message on timeout', async () => {
      // Set a short timeout for testing
      process.env.POLTERGEIST_DAEMON_TIMEOUT = '1000';

      // Mock fork to simulate slow startup
      mockFork.mockImplementation(() => {
        const mockChild = {
          once: vi.fn(),
          unref: vi.fn(),
          disconnect: vi.fn(),
          kill: vi.fn(),
        };

        mockChild.once.mockImplementation((_event, _callback) => {
          // Never call the callback to simulate timeout
        });

        return mockChild as any;
      });

      const config: PoltergeistConfig = {
        version: '1.0',
        projectType: 'node',
        targets: [],
      };

      // Should timeout with helpful message
      await expect(
        daemonManager.startDaemonWithRetry(
          config,
          {
            projectRoot: testDir,
          },
          1
        )
      ).rejects.toThrow(
        /Daemon startup timeout after 1000ms.*Try setting POLTERGEIST_DAEMON_TIMEOUT/
      );

      // Clean up environment variable
      delete process.env.POLTERGEIST_DAEMON_TIMEOUT;
    }, 5000);
  });
});
