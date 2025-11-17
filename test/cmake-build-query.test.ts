import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { queryBuildSystem } from '../src/utils/cmake-build-query.js';
import type { CommandRunner, RunResult } from '../src/utils/command-runner.js';

class FakeRunner implements CommandRunner {
  constructor(private readonly stdout: string) {}

  async run(): Promise<RunResult> {
    return { stdout: this.stdout, stderr: '', exitCode: 0 };
  }
}

describe('cmake-build-query', () => {
  it('parses targets from cmake --build help output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmake-build-query-'));
    const buildDir = join(dir, 'build');
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, 'CMakeCache.txt'), 'CMAKE_GENERATOR:INTERNAL=Ninja');
    writeFileSync(join(buildDir, 'build.ninja'), '');

    const stdout = `
The following are some of the valid targets
... app
... libfoo
`;

    const result = await queryBuildSystem(dir, new FakeRunner(stdout), true);
    expect(result.generator).toBe('Ninja');
    expect(result.targets.map((t) => t.name)).toContain('app');
    expect(result.buildDirectory).toBe('build');

    rmSync(dir, { recursive: true, force: true });
  });
});
