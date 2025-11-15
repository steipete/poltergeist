import { describe, expect, it } from 'vitest';
import { GitMetricsCollector } from '../../src/panel/git-metrics.js';

describe('GitMetricsCollector', () => {
  it('parses dirty files, branch, and diff stats', async () => {
    const runner = async (args: string[]) => {
      if (args[0] === 'status') {
        return [
          '# branch.head main',
          '# branch.upstream origin/main',
          '1 XYZ. N... 100644 100644 100644 abc123... file.ts',
          '? new-file.ts',
          '',
        ].join('\0');
      }
      if (args[0] === 'diff') {
        return ' 3 files changed, 12 insertions(+), 5 deletions(-)';
      }
      return '';
    };

    const collector = new GitMetricsCollector({ throttleMs: 0, runner });
    const metrics = await collector.refresh('/tmp/project', true);

    expect(metrics.dirtyFiles).toBe(2);
    expect(metrics.branch).toBe('main');
    expect(metrics.insertions).toBe(12);
    expect(metrics.deletions).toBe(5);
    expect(metrics.hasRepo).toBe(true);
  });

  it('falls back gracefully when git commands fail', async () => {
    const failingRunner = async () => {
      throw new Error('git missing');
    };
    const collector = new GitMetricsCollector({ runner: failingRunner });
    const metrics = await collector.refresh('/tmp/project', true);

    expect(metrics.hasRepo).toBe(false);
    expect(metrics.dirtyFiles).toBe(0);
    expect(metrics.insertions).toBe(0);
    expect(metrics.deletions).toBe(0);
  });
});
