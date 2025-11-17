import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';

// Regression test for issue #55: start/haunt should return immediately (non-blocking daemon spawn).
// We run the CLI in POLTERGEIST_TEST_MODE so no real daemon or watchman work occurs, but the
// control-flow and exit behavior matches the real command path.
describe('daemon start detaches promptly', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'polt-detach-'));
  const configPath = join(tempDir, 'poltergeist.config.json');

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        version: '1.0',
        projectType: 'node',
        targets: [
          {
            name: 'noop',
            type: 'executable',
            enabled: true,
            buildCommand: 'echo build',
            outputPath: './dist/noop',
            watchPaths: ['src/**/*.ts'],
          },
        ],
      },
      null,
      2
    )
  );

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('haunt/start exits within a couple seconds', () => {
    const startedAt = Date.now();

    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/cli.ts', 'haunt', '--config', configPath],
      {
        cwd: process.cwd(),
        env: { ...process.env, POLTERGEIST_TEST_MODE: 'true' },
        encoding: 'utf-8',
        timeout: 5000,
      }
    );

    const elapsedMs = Date.now() - startedAt;

    if (result.error) {
      throw result.error;
    }

    expect(result.status).toBe(0);
    expect(result.stdout || '').toMatch(/daemon started/i);
    // Should not hang the shell; allow some headroom for CI.
    expect(elapsedMs).toBeLessThan(4000);
  });
});
