import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { stripAnsi } from '../../src/utils/ansi.js';

let statusCallCount = 0;
let statusSequence: Array<'building' | 'success' | 'failure'> = ['building', 'success'];

vi.mock('../../src/cli/shared.js', () => ({
  loadConfigOrExit: vi.fn().mockResolvedValue({
    config: {
      version: '1.0',
      projectType: 'node',
      targets: [{ name: 'app', type: 'executable', enabled: true, buildCommand: 'echo' }],
    },
    projectRoot: '/tmp/project',
    configPath: '/tmp/project/poltergeist.config.json',
  }),
  exitWithError: (msg: string) => {
    throw new Error(msg);
  },
  parseGitModeOrExit: vi.fn(),
  ensureOrExit: (cond: any, msg: string) => {
    if (!cond) throw new Error(msg);
  },
}));

vi.mock('../../src/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

vi.mock('../../src/factories.js', () => ({
  createPoltergeist: () => ({
    getStatus: vi.fn(async () => {
      statusCallCount += 1;
      const next = statusSequence.shift() ?? 'success';
      if (next === 'building') {
        return {
          app: {
            lastBuild: { status: 'building', timestamp: new Date().toISOString() },
            buildCommand: 'echo',
          },
        };
      }

      if (next === 'failure') {
        return {
          app: {
            lastBuild: {
              status: 'failure',
              timestamp: new Date().toISOString(),
              duration: 1500,
              errorSummary: 'boom',
            },
            buildCommand: 'echo',
          },
        };
      }
      return {
        app: {
          lastBuild: {
            status: 'success',
            timestamp: new Date().toISOString(),
            duration: 1200,
          },
          buildCommand: 'echo',
        },
      };
    }),
  }),
}));

import { registerStatusCommands } from '../../src/cli/commands/status.js';

describe('wait --json', () => {
  it('emits JSON on success without blocking real time', async () => {
    statusSequence = ['building', 'success'];
    const program = new Command();
    registerStatusCommands(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();

    const parsePromise = program.parseAsync(['wait', '--json'], { from: 'user' });

    // Let all scheduled timers in wait loop run
    await vi.runAllTimersAsync();
    await parsePromise;

    const output = logSpy.mock.calls.map((c) => stripAnsi(String(c[0]))).join('\n');

    vi.useRealTimers();
    logSpy.mockRestore();
    expect(output).toContain('"status": "success"');
    expect(statusCallCount).toBeGreaterThanOrEqual(2);
  });

  it('rejects when build fails', async () => {
    statusCallCount = 0;
    statusSequence = ['building', 'failure'];
    const program = new Command();
    registerStatusCommands(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
    const parsePromise = program.parseAsync(['wait', '--json'], { from: 'user' });
    // Prevent unhandled rejection warning while we assert below.
    parsePromise.catch(() => {});

    // First status: building, second: failure
    await vi.runAllTimersAsync();

    await expect(parsePromise).rejects.toThrow('Build failed');
    vi.useRealTimers();
    logSpy.mockRestore();
  });
});
