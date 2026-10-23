import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('built daemon resolves and loads its worker from a path containing spaces', () => {
  const temp = mkdtempSync(join(tmpdir(), 'poltergeist worker '));
  try {
    cpSync(join(root, 'dist'), join(temp, 'dist'), { recursive: true });
    writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
    symlinkSync(join(root, 'node_modules'), join(temp, 'node_modules'), 'junction');
    mkdirSync(join(temp, 'project'));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { DaemonManager } from './dist/daemon/daemon-manager.js';
      import { createLogger } from './dist/logger.js';
      const manager = new DaemonManager(createLogger());
      // The worker must load and reply over IPC before this deliberate config error.
      await assert.rejects(manager.startDaemonWithRetry(
        { version: '1.0', projectType: 'node', targets: [] },
        { projectRoot: process.env.TEST_PROJECT, target: 'missing' },
        1,
      ), /Target 'missing' not found/);
      console.log('Worker loaded and returned the expected startup error over IPC');
    `], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        TEST_PROJECT: join(temp, 'project'),
        POLTERGEIST_STATE_DIR: join(temp, 'state'),
        POLTERGEIST_DAEMON_TIMEOUT: '10000',
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Worker loaded and returned/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('built logs CLI renders compiler text and JSON without losing target filtering', () => {
  const temp = mkdtempSync(join(tmpdir(), 'poltergeist logs '));
  try {
    writeFileSync(join(temp, 'poltergeist.config.json'), JSON.stringify({
      version: '1.0',
      projectType: 'node',
      targets: [{
        name: 'demo', type: 'executable', enabled: true,
        buildCommand: 'echo demo', outputPath: './demo', watchPaths: ['src/**'],
      }],
    }));
    writeFileSync(join(temp, 'demo.log'), [
      'src/main.go:10: undefined: foo',
      '{"reason":"compile failed"}',
      '{"unfinished":',
      '12:34:56 INFO: [other] hidden target',
      '12:34:57 INFO: [demo] Build failed',
      '{"timestamp":"12:34:58","level":"info","message":"hidden JSON","target":"other"}',
    ].join('\n'));
    const result = spawnSync(process.execPath, [join(root, 'dist/cli.js'), 'logs', 'demo'], {
      cwd: temp,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, POLTERGEIST_STATE_DIR: join(temp, 'state'), NO_COLOR: '1' },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /src\/main.go:10: undefined: foo/);
    assert.match(result.stdout, /\{"reason":"compile failed"\}/);
    assert.match(result.stdout, /\{"unfinished":/);
    assert.match(result.stdout, /Build failed/);
    assert.doesNotMatch(result.stdout, /hidden target|hidden JSON/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
