import { describe, expect, it } from 'vitest';
import { ChildProcessRunner } from '../src/utils/command-runner.js';

describe('ChildProcessRunner', () => {
  const runner = new ChildProcessRunner();

  it('captures stdout from successful command', async () => {
    const result = await runner.run('node', ['-e', "console.log('ok')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('ok');
  });

  it('rejects on non-zero exit when not allowed', async () => {
    await expect(runner.run('node', ['-e', 'process.exit(2)'])).rejects.toThrow();
  });

  it('can allow non-zero exit codes', async () => {
    const result = await runner.run('node', ['-e', 'process.exit(3)'], { allowNonZeroExit: true });
    expect(result.exitCode).toBe(3);
  });
});
