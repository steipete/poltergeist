import { describe, expect, it, vi } from 'vitest';
import { program } from '../src/cli.js';

vi.mock('../src/factories.js');
vi.mock('../src/logger.js');
vi.mock('../src/utils/config-manager.js');
vi.mock('../src/state.js');
vi.mock('../src/builders/index.js');
vi.mock('fs');
vi.mock('path');

describe('build command lock handling', () => {
  it('shows lock hint when builder reports building', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mockBuilder = {
      build: vi.fn().mockResolvedValue({ status: 'building' }),
    };

    const { createBuilder } = await import('../src/builders/index.js');
    vi.mocked(createBuilder).mockReturnValue(mockBuilder as any);

    const { ConfigurationManager } = await import('../src/utils/config-manager.js');
    vi.mocked(ConfigurationManager.getConfig).mockResolvedValue({
      config: {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'demo',
            type: 'executable',
            buildCommand: 'echo',
            outputPath: './dist/demo',
            watchPaths: ['src/**/*'],
            enabled: true,
          },
        ],
      },
      projectRoot: '/project',
      configPath: '/project/poltergeist.config.json',
    } as any);

    const { createLogger } = await import('../src/logger.js');
    vi.mocked(createLogger).mockReturnValue({ info: vi.fn(), error: vi.fn() } as any);

    try {
      await program.parseAsync(['node', 'cli.js', 'build', 'demo']);
    } catch {
      // exitWithError triggers process.exit
    }

    const output = consoleError.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Build skipped because another build is already running');

    consoleError.mockRestore();
    consoleLog.mockRestore();
  });
});
