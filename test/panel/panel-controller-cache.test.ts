import { describe, expect, it, vi } from 'vitest';
import type { PoltergeistConfig } from '../../src/types.js';

vi.mock('../../src/panel/script-runner.js', () => {
  const runStatusScript = vi.fn(async (script: any) => ({
    label: script.label,
    lines: ['ok'],
    targets: script.targets,
    lastRun: Date.now(),
    exitCode: 0,
    durationMs: 1,
    maxLines: script.maxLines ?? 1,
  }));

  const runSummaryScript = vi.fn(async (script: any) => ({
    label: script.label,
    lines: ['summary'],
    lastRun: Date.now(),
    exitCode: 0,
    durationMs: 1,
    placement: script.placement ?? 'summary',
    maxLines: script.maxLines ?? 10,
    formatter: script.formatter,
  }));

  return { runStatusScript, runSummaryScript, extractLines: vi.fn() };
});

const { runStatusScript } = await import('../../src/panel/script-runner.js');
const { StatusPanelController } = await import('../../src/panel/panel-controller.js');

describe('panel-controller script caching', () => {
  it('respects cooldown and avoids rerunning scripts within window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const config: PoltergeistConfig = {
      version: '1.0',
      projectType: 'custom',
      targets: [{ name: 'app', type: 'custom', enabled: true }],
      statusScripts: [
        {
          label: 'once',
          command: 'echo ok',
          cooldownSeconds: 60,
        },
      ],
    };

    const controller = new StatusPanelController({
      config,
      projectRoot: process.cwd(),
      fetchStatus: async () => ({}),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    await (controller as any).refreshStatusScripts(true);
    expect(runStatusScript).toHaveBeenCalledTimes(1);

    // within cooldown -> cached
    vi.setSystemTime(new Date('2025-01-01T00:00:30Z'));
    await (controller as any).refreshStatusScripts();
    expect(runStatusScript).toHaveBeenCalledTimes(1);

    // after cooldown -> reruns
    vi.setSystemTime(new Date('2025-01-01T00:01:10Z'));
    await (controller as any).refreshStatusScripts();
    expect(runStatusScript).toHaveBeenCalledTimes(2);
  });
});
