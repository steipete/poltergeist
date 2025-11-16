import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

let statusCallCount = 0;

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
      if (statusCallCount === 1) {
        return {
          app: {
            lastBuild: { status: 'building', timestamp: new Date().toISOString() },
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

const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*m/g, '');

describe('wait --json', () => {
  it('emits JSON on success without blocking real time', async () => {
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
});
