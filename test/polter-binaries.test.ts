import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBinaryPath } from '../src/polter/binaries.js';

const tmpRoot = resolve('.polter-binaries-test');

describe('resolveBinaryPath', () => {
  afterEach(() => {
    if (existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('prefers dist output when multiple candidates exist', () => {
    mkdirSync(join(tmpRoot, 'dist'), { recursive: true });
    writeFileSync(join(tmpRoot, 'dist', 'my-app'), 'binary');
    writeFileSync(join(tmpRoot, 'my-app'), 'older-binary');

    const resolved = resolveBinaryPath('my-app', tmpRoot);
    expect(resolved).toBe(join(tmpRoot, 'dist', 'my-app'));
  });

  it('returns null when no candidate exists', () => {
    mkdirSync(tmpRoot, { recursive: true });
    const resolved = resolveBinaryPath('missing', tmpRoot);
    expect(resolved).toBeNull();
  });
});
