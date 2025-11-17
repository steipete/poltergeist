import { describe, expect, it } from 'vitest';
import { extractLines, runStatusScript, runSummaryScript } from '../../src/panel/script-runner.js';

const projectRoot = process.cwd();

describe('script-runner', () => {
  it('extracts trimmed lines and respects max lines', () => {
    const lines = extractLines('  hello \nworld\n\n', '  ', 1);
    expect(lines).toEqual(['hello']);
  });

  it('runs status script and limits output lines', async () => {
    const result = await runStatusScript(
      {
        label: 'echo',
        command: 'printf "first line\\nsecond line\\n"',
        maxLines: 1,
      },
      projectRoot
    );

    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual(['first line']);
    expect(result.maxLines).toBe(1);
  });

  it('captures non-zero exit code and stderr for summary scripts', async () => {
    const result = await runSummaryScript(
      {
        label: 'fail',
        command: 'node -e "console.error(\\"badness\\"); process.exit(2)"',
        maxLines: 2,
        placement: 'summary',
      },
      projectRoot
    );

    expect(result.exitCode).toBe(2);
    expect(result.lines[0]).toContain('badness');
    expect(result.placement).toBe('summary');
  });
});
