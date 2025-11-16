import { existsSync, readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('fs');
vi.mock('../src/factories.js');
vi.mock('../src/logger.js');
vi.mock('../src/utils/config-manager.js');

describe('wait command edge cases', () => {
  it('prints guidance when multiple builds are running', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { program } = await import('../src/cli.js');
    const { ConfigurationManager } = await import('../src/utils/config-manager.js');
    const { createLogger } = await import('../src/logger.js');
    const { createPoltergeist } = await import('../src/factories.js');

    const mockConfig = {
      version: '1.0',
      projectType: 'node',
      targets: [
        {
          name: 'a',
          type: 'executable',
          buildCommand: 'echo',
          outputPath: 'a',
          watchPaths: [],
          enabled: true,
        },
        {
          name: 'b',
          type: 'executable',
          buildCommand: 'echo',
          outputPath: 'b',
          watchPaths: [],
          enabled: true,
        },
      ],
    } as const;

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockConfig));
    vi.mocked(ConfigurationManager.getConfig).mockResolvedValue({
      config: mockConfig,
      projectRoot: '/project',
      configPath: '/project/poltergeist.config.json',
    } as any);
    vi.mocked(createLogger).mockReturnValue({ info: vi.fn(), error: vi.fn() } as any);

    vi.mocked(createPoltergeist).mockReturnValue({
      getStatus: vi.fn().mockResolvedValue({
        a: { lastBuild: { status: 'building', buildCommand: 'echo a' } },
        b: { lastBuild: { status: 'building', buildCommand: 'echo b' } },
      }),
    } as any);

    try {
      await program.parseAsync(['node', 'cli.js', 'wait']);
    } catch {
      // exitWithError -> process.exit
    }

    const output = consoleError.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Multiple targets building');
    expect(output).toContain('Usage: poltergeist wait <target>');

    consoleError.mockRestore();
    consoleLog.mockRestore();
  });
});
