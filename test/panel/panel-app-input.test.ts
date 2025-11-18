import { describe, expect, it, vi } from 'vitest';

import { PanelApp } from '../../src/panel/panel-app.js';
import type { PanelSnapshot } from '../../src/panel/types.js';

const snapshot: PanelSnapshot = {
  targets: [],
  summary: { totalTargets: 0, building: 0, failures: 0, running: 0 },
  git: { branch: 'main', hasRepo: true, dirtyFiles: 0, insertions: 0, deletions: 0 },
  projectName: 'app',
  projectRoot: '/tmp/app',
  preferredIndex: 0,
  lastUpdated: Date.now(),
  statusScripts: [],
  summaryScripts: [],
  paused: true,
};

describe('PanelApp input handling', () => {
  it('pressing r while paused resumes immediately (optimistic)', async () => {
    const resume = vi.fn(async () => {});
    const controller = {
      getSnapshot: () => snapshot,
      onUpdate: () => () => {},
      onLogUpdate: () => () => {},
      onScriptEvent: () => () => {},
      pause: vi.fn(),
      resume,
      forceRefresh: vi.fn(),
      getLogLines: async (_name: string, _channel?: string, _limit?: number) => [],
    };

    const app = new PanelApp({
      controller: controller as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
    });

    // Call the private handler directly for simplicity.
    (app as any).handleInput('r');
    await Promise.resolve(); // allow resume().then(...) to run
    expect(resume).toHaveBeenCalledTimes(1);
    expect((app as any).snapshot.paused).toBe(false);
  });
});
