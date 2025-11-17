import { describe, expect, it, vi } from 'vitest';
import { StatusPanelController } from '../../src/panel/panel-controller.js';
import type { PoltergeistConfig } from '../../src/types.js';

describe('script-event sink', () => {
  it('invokes scriptEventSink on failure', async () => {
    const config: PoltergeistConfig = {
      version: '1.0',
      projectType: 'node',
      targets: [
        { name: 'app', type: 'custom', enabled: true, watchPaths: ['.'], buildCommand: 'echo' },
      ],
      statusScripts: [{ label: 'fail', command: 'node -e "process.exit(3)"' }],
    };
    const sink = vi.fn();
    const controller = new StatusPanelController({
      config,
      projectRoot: process.cwd(),
      fetchStatus: async () => ({}),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      scriptEventSink: sink,
    });

    await (controller as any).refreshStatusScripts(true);
    expect(sink).toHaveBeenCalled();
    const event = sink.mock.calls[0][0];
    expect(event.kind).toBe('status');
    expect(event.label).toBe('fail');
    expect(event.exitCode).toBe(3);
  });
});
