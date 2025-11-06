import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExecutableTarget } from '../../src/types.js';
import { LaunchPreparationError, prepareLaunchInfo } from '../../src/utils/launch.js';

const tempDirs: string[] = [];

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'poltergeist-launch-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('prepareLaunchInfo', () => {
  it('throws when outputPath is missing', () => {
    const target: ExecutableTarget = {
      name: 'sample',
      type: 'executable',
      buildCommand: 'go build',
      outputPath: '',
      watchPaths: [],
    };

    expect(() => prepareLaunchInfo(target, process.cwd(), [])).toThrow(LaunchPreparationError);
  });

  it('returns binary path for native executables', () => {
    const project = createTempProject();
    const outputPath = './dist/app';
    const absolutePath = join(project, 'dist', 'app');
    mkdirSync(join(project, 'dist'), { recursive: true });
    writeFileSync(absolutePath, '');

    const target: ExecutableTarget = {
      name: 'app',
      type: 'executable',
      buildCommand: 'go build',
      outputPath,
      watchPaths: [],
    };

    const info = prepareLaunchInfo(target, project, []);
    expect(info.command).toBe(absolutePath);
    expect(info.commandArgs).toEqual([]);
    expect(info.binaryPath).toBe(absolutePath);
  });

  it('wraps node scripts with node interpreter', () => {
    const project = createTempProject();
    const outputPath = './dist/server.js';
    const absolutePath = join(project, 'dist', 'server.js');
    mkdirSync(join(project, 'dist'), { recursive: true });
    writeFileSync(absolutePath, '');

    const target: ExecutableTarget = {
      name: 'server',
      type: 'executable',
      buildCommand: 'tsc',
      outputPath,
      watchPaths: [],
    };

    const info = prepareLaunchInfo(target, project, ['--port', '3000']);
    expect(info.command).toBe('node');
    expect(info.commandArgs).toEqual([absolutePath, '--port', '3000']);
  });
});
