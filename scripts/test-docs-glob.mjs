import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { glob } = await import(new URL('./node-utils.js', import.meta.resolve('typedoc')));

test('TypeDoc discovers nested entry points with patched minimatch', t => {
  const root = mkdtempSync(join(tmpdir(), 'poltergeist-typedoc-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['src/index.ts', 'src/nested/view.tsx', 'src/skip.js', 'docs/other.ts', 'node_modules/pkg/index.ts']) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  const base = root.replaceAll('\\', '/');
  assert.deepEqual(glob(`${base}/src/**/*.{ts,tsx}`, root).sort(), [
    `${base}/src/index.ts`,
    `${base}/src/nested/view.tsx`,
  ]);
  assert.deepEqual(glob(`${base}/**/*.ts`, root).sort(), [
    `${base}/docs/other.ts`,
    `${base}/src/index.ts`,
  ]);
  assert.deepEqual(glob(`${base}/node_modules/**/*.ts`, root), [
    `${base}/node_modules/pkg/index.ts`,
  ]);
});
