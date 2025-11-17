import { describe, expect, it, vi } from 'vitest';
import { StatusPanelController } from '../../src/panel/panel-controller.js';
import type { PoltergeistConfig } from '../../src/types.js';

describe('panel-controller script events', () => {
  it('emits script-event on status script failure', async () => {
    const config: PoltergeistConfig = {
      version: '1.0',
      projectType: 'custom',
      targets: [{ name: 'app', type: 'custom', enabled: true }],
      statusScripts: [
        {
          label: 'fail',
          command: 'node -e "process.exit(2)"',
          cooldownSeconds: 0,
        },
      ],
    };

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const controller = new StatusPanelController({
      config,
      projectRoot: process.cwd(),
      fetchStatus: async () => ({}),
      logger: logger as any,
    });

    const events: any[] = [];
    controller.onScriptEvent((e) => events.push(e));

    await (controller as any).refreshStatusScripts(true);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ kind: 'status', label: 'fail', exitCode: 2 });
  });
});
