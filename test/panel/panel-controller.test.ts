import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/logger.js';
import { StatusPanelController } from '../../src/panel/panel-controller.js';

const noopLogger: Logger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  success: () => {},
};

describe('StatusPanelController', () => {
  it('includes status script failures in the summary totals', async () => {
    const controller = new StatusPanelController({
      config: {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'build',
            type: 'npm',
            enabled: true,
            watchPaths: ['src/**/*'],
            buildCommand: 'echo build',
          },
        ],
        statusScripts: [{ label: 'Typecheck', command: 'echo fail' }],
      },
      projectRoot: '/tmp/panel-test',
      fetchStatus: async () => ({
        build: {
          status: 'watching',
          lastBuild: { status: 'success', timestamp: new Date().toISOString() },
        },
      }),
      logger: noopLogger,
    });

    vi.spyOn(controller as any, 'runStatusScript').mockResolvedValue({
      label: 'Typecheck',
      lines: ['Typecheck failed'],
      targets: undefined,
      lastRun: Date.now(),
      exitCode: 2,
      durationMs: 25,
      maxLines: 6,
    });

    await (controller as any).refreshStatusScripts(true);

    const summary = controller.getSnapshot().summary;
    expect(summary.scriptFailures).toBe(1);
    expect(summary.failures).toBe(1);
    expect(summary.targetFailures ?? 0).toBe(0);
  });
});
