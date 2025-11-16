import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/cli/shared.js', () => ({
  loadConfigOrExit: vi.fn().mockResolvedValue({
    config: {
      version: '1.0',
      projectType: 'node',
      targets: [{ name: 'app', type: 'executable', enabled: true, buildCommand: 'echo ok', watchPaths: ['src/**'] }],
    },
    projectRoot: '/tmp/project',
    configPath: '/tmp/project/poltergeist.config.json',
  }),
  exitWithError: (msg: string) => {
    throw new Error(msg);
  },
  parseGitModeOrExit: vi.fn((mode?: string) => mode ?? 'ai'),
  ensureOrExit: (cond: any, msg: string) => {
    if (!cond) throw new Error(msg);
  },
}));

const runStatusPanelMock = vi.fn();
vi.mock('../../src/panel/run-panel.js', () => ({
  runStatusPanel: (...args: any[]) => runStatusPanelMock(...args),
}));

vi.mock('../../src/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

import { registerStatusCommands } from '../../src/cli/commands/status.js';

describe('status panel command (smoke)', () => {
  it('invokes runStatusPanel with loaded config', async () => {
    const program = new Command();
    registerStatusCommands(program);

    await program.parseAsync(['status', 'panel', '--config', '/tmp/fake.json'], { from: 'user' });

    expect(runStatusPanelMock).toHaveBeenCalledTimes(1);
    const args = runStatusPanelMock.mock.calls[0][0];
    expect(args.projectRoot).toBe('/tmp/project');
    expect(args.config.targets[0].name).toBe('app');
    expect(args.gitSummaryMode).toBe('ai');
  });
});
