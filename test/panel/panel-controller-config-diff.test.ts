import { promises as fs, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { StatusPanelController } from '../../src/panel/panel-controller.js';
import type { PoltergeistConfig } from '../../src/types.js';

async function writeConfig(path: string, config: PoltergeistConfig): Promise<void> {
  await fs.writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
}

describe('panel-controller config diff logging', () => {
  it('logs added/removed targets on reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-diff-'));
    const configPath = join(dir, 'poltergeist.config.json');

    const baseConfig: PoltergeistConfig = {
      version: '1.0',
      projectType: 'node',
      targets: [
        { name: 'one', type: 'custom', enabled: true, watchPaths: ['.'], buildCommand: 'echo one' },
        { name: 'two', type: 'custom', enabled: true, watchPaths: ['.'], buildCommand: 'echo two' },
      ],
    };

    await writeConfig(configPath, baseConfig);

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const controller = new StatusPanelController({
      config: baseConfig,
      projectRoot: dir,
      configPath,
      fetchStatus: async () => ({}),
      logger: logger as any,
    });

    const nextConfig: PoltergeistConfig = {
      ...baseConfig,
      targets: [
        { name: 'two', type: 'custom', enabled: true, watchPaths: ['.'], buildCommand: 'echo two' },
        {
          name: 'three',
          type: 'custom',
          enabled: true,
          watchPaths: ['.'],
          buildCommand: 'echo three',
        },
      ],
    };
    await writeConfig(configPath, nextConfig);

    await (controller as any).reloadConfig();

    const infoCalls = logger.info.mock.calls.map((c) => String(c[0]));
    const warnCalls = logger.warn.mock.calls.length;
    expect(warnCalls).toBe(0);
    const match = infoCalls.find((m) => m.includes('Config target diff'));
    expect(match).toBeTruthy();
    expect(match).toContain('added: three');
    expect(match).toContain('removed: one');
  });
});
