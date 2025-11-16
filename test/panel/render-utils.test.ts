import { describe, expect, it } from 'vitest';
import {
  formatFooter,
  formatHeader,
  formatTargets,
  renderControlsLine,
  stripAnsiCodes,
} from '../../src/panel/render-utils.js';
import { buildTargetRows } from '../../src/panel/target-tree.js';
import type { TargetPanelEntry } from '../../src/panel/types.js';

const makeTarget = (name: string, group?: string): TargetPanelEntry => ({
  name,
  status: {},
  targetType: 'test',
  enabled: true,
  logChannels: ['build'],
  group,
});

describe('render utils', () => {
  it('centers controls line in the footer for narrow terminals', () => {
    const controls = renderControlsLine(40);
    const footer = formatFooter(controls, 40);
    const lines = footer.split('\n');
    expect(lines).toHaveLength(2);
    const controlLine = stripAnsiCodes(lines[1]);
    const leftPad = controlLine.indexOf('↑/↓');
    const rightPad =
      controlLine.length - leftPad - '↑/↓ move · ←/→ cycle · r refresh · q quit'.length;
    expect(Math.abs(leftPad - rightPad)).toBeLessThanOrEqual(1);
  });

  it('renders grouped connectors for child targets', () => {
    const rows = buildTargetRows([
      makeTarget('Suite'),
      makeTarget('Unit', 'Suite'),
      makeTarget('Integration', 'Suite'),
    ]);
    const text = formatTargets(rows, 0, new Map(), 50);
    const plain = text
      .split('\n')
      .map(stripAnsiCodes)
      .filter(
        (line) => line.includes('Suite') || line.includes('Unit') || line.includes('Integration')
      );
    expect(plain.some((line) => line.includes('Suite'))).toBe(true);
    expect(plain.some((line) => line.includes('├─ Unit'))).toBe(true);
    expect(plain.some((line) => line.includes('└─ Integration'))).toBe(true);
  });

  it('truncates long target names with ellipsis on narrow columns', () => {
    const rows = buildTargetRows([makeTarget('ThisIsAVeryLongTargetNameExceedingWidth')]);
    const text = formatTargets(rows, 0, new Map(), 22);
    const line = stripAnsiCodes(text.split('\n')[2]); // first target row after headers
    expect(line).toMatch(/ThisIsAVeryLong.*…/);
  });

  it('elides duration before overflowing the status column', () => {
    const now = Date.now();
    const target: TargetPanelEntry = {
      ...makeTarget('short'),
      status: {
        lastBuild: {
          status: 'failure',
          timestamp: new Date(now - 3_600_000).toISOString(),
          duration: 12_345,
        },
      },
    };
    const rows = buildTargetRows([target]);
    const text = formatTargets(rows, 0, new Map(), 26); // targetCol=18, statusCol=16 (min)
    const statusPart = stripAnsiCodes(text.split('\n')[2]).slice(18).trim();
    expect(statusPart).toBe('✗ failure 1h ago');
    expect(statusPart).not.toContain('12s');
  });

  it('still truncates overly long badges when needed', () => {
    const target: TargetPanelEntry = {
      ...makeTarget('short'),
      status: {
        lastBuild: {
          status: 'this-status-label-is-way-too-long',
          timestamp: new Date(Date.now() - 3_600_000).toISOString(),
        },
      },
    };
    const rows = buildTargetRows([target]);
    const text = formatTargets(rows, 0, new Map(), 26);
    const statusPart = stripAnsiCodes(text.split('\n')[2]).slice(18);
    expect(statusPart).toContain('…');
  });

  it('renders compact header separators on narrow width', () => {
    const snapshot = {
      projectName: 'proj',
      projectRoot: '/tmp/proj',
      git: { branch: 'main', hasRepo: true, dirtyFiles: 0, insertions: 0, deletions: 0 },
      summary: {
        totalTargets: 1,
        building: 0,
        failures: 0,
        targetFailures: 0,
        scriptFailures: 0,
        running: 1,
        activeDaemons: [],
      },
      targets: [],
      preferredIndex: 0,
      lastUpdated: Date.now(),
    };
    const header = formatHeader(snapshot as any, 60);
    const plain = stripAnsiCodes(header);
    expect(plain).toContain('·'); // narrow mode uses dots as separators
  });

  it('renders compact separators on medium width', () => {
    const snapshot = {
      projectName: 'proj',
      projectRoot: '/tmp/proj',
      git: { branch: 'main', hasRepo: true, dirtyFiles: 0, insertions: 0, deletions: 0 },
      summary: {
        totalTargets: 1,
        building: 0,
        failures: 0,
        targetFailures: 0,
        scriptFailures: 0,
        running: 1,
        activeDaemons: [],
      },
      targets: [],
      preferredIndex: 0,
      lastUpdated: Date.now(),
    };
    const header = formatHeader(snapshot as any, 80);
    const plain = stripAnsiCodes(header);
    expect(plain).toContain(' · '); // compact mode uses spaced middots
  });

  it('hides the progress bar once a build reports 100%', () => {
    const target: TargetPanelEntry = {
      ...makeTarget('Integration'),
      status: {
        lastBuild: {
          status: 'building',
          timestamp: new Date().toISOString(),
          progress: { percent: 100, current: 68, total: 68, updatedAt: new Date().toISOString() },
        },
      },
    };
    const rows = buildTargetRows([target]);
    const text = formatTargets(rows, 0, new Map(), 60);
    const statusPart = stripAnsiCodes(text.split('\n')[2]).slice(18);
    expect(statusPart).not.toContain('['); // no bar
    expect(statusPart).toContain('building'); // badge still present
  });

  it('renders block bars when ASCII fallback is not forced', () => {
    const target: TargetPanelEntry = {
      ...makeTarget('Integration'),
      status: {
        lastBuild: {
          status: 'building',
          progress: { percent: 50, current: 5, total: 10, updatedAt: new Date().toISOString() },
        },
      },
    };
    const rows = buildTargetRows([target]);
    const text = formatTargets(rows, 0, new Map(), 60);
    const statusPart = text.split('\n')[2]; // keep ANSI
    expect(statusPart).toMatch(/[█░]/);
  });
});
