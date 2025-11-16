import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'fs';

vi.mock('fs');

describe('logs command missing file behavior', () => {
  it('prints helpful message when no log file exists', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(existsSync).mockReturnValue(false);

    const { program } = await import('../src/cli.js');

    try {
      await program.parseAsync(['node', 'cli.js', 'logs', 'demo']);
    } catch (e) {
      // exitWithError throws through process.exit
    }

    const output = consoleError.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No log file found for target: demo');
    expect(output).toContain('Start Poltergeist to generate logs');

    consoleError.mockRestore();
    consoleLog.mockRestore();
  });
});

