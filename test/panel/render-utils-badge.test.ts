import { afterEach, describe, expect, it } from 'vitest';
import { formatTargets } from '../../src/panel/render-utils.js';
import type { TargetRow } from '../../src/panel/target-tree.js';
import type { PanelStatusScriptResult } from '../../src/panel/types.js';

const monoEnv = process.env.POLTERGEIST_MONOCHROME;

afterEach(() => {
  if (monoEnv === undefined) {
    delete process.env.POLTERGEIST_MONOCHROME;
  } else {
    process.env.POLTERGEIST_MONOCHROME = monoEnv;
  }
});

describe('render-utils script badges', () => {
  it('shows red badge on failing script and yellow on unknown', () => {
    process.env.POLTERGEIST_MONOCHROME = '1'; // simplify assertions
    const rows: TargetRow[] = [
      { target: { name: 'ok', status: { status: 'success' } }, depth: 0, connector: 'root' },
      { target: { name: 'fail', status: { status: 'success' } }, depth: 0, connector: 'root' },
      { target: { name: 'unknown', status: { status: 'success' } }, depth: 0, connector: 'root' },
    ];

    const scripts = new Map<string, PanelStatusScriptResult[]>();
    scripts.set('fail', [
      { label: 'lint', lines: ['boom'], lastRun: Date.now(), exitCode: 2, durationMs: 1 },
    ]);
    scripts.set('unknown', [
      { label: 'maybe', lines: ['maybe'], lastRun: Date.now(), exitCode: null, durationMs: 1 },
    ]);

    const out = formatTargets(rows, 0, scripts, 80);
    expect(out).toContain('ok');
    expect(out).toContain('fail ✖ script');
    expect(out).toContain('unknown ⚠ script');
  });
});
