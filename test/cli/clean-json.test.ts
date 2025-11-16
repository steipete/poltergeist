import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const listAllStatesMock = vi.fn();
const removeStateMock = vi.fn();

vi.mock('../../src/state.js', () => ({
  StateManager: class {
    constructor() {}
    static listAllStates = listAllStatesMock;
    readState = vi.fn().mockResolvedValue({
      projectName: 'demo',
      target: 'app',
      process: { isActive: false, lastHeartbeat: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
    });
    removeState = removeStateMock;
  },
}));

vi.mock('../../src/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock('../../src/utils/filesystem.js', () => ({ FileSystemUtils: { findProjectRoot: () => '/tmp/project' } }));

import { registerProjectCommands } from '../../src/cli/commands/project.js';

describe('clean --json', () => {
  it('outputs json summary and removes files', async () => {
    listAllStatesMock.mockResolvedValue(['demo-1234-app.state']);
    removeStateMock.mockResolvedValue(undefined);

    const program = new Command();
    registerProjectCommands(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await program.parseAsync(['clean', '--json'], { from: 'user' });

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    logSpy.mockRestore();

    expect(output).toContain('"removed": 1');
    expect(output).toContain('demo-1234-app.state');
    expect(removeStateMock).toHaveBeenCalledTimes(1);
  });
});
