import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'child_process';
import { isBinaryFresh, resolveBinaryPath } from '../src/polter.js';
import { FileSystemUtils } from '../src/utils/filesystem.js';
import type { PoltergeistState } from '../src/state.js';

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execSync: vi.fn() };
});

const TARGET = 'demo-target';
const cleanGitHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function writeState(projectRoot: string, timestamp: string) {
  const state: PoltergeistState = {
    version: '1.0',
    projectPath: projectRoot,
    projectName: path.basename(projectRoot),
    target: TARGET,
    targetType: 'executable',
    configPath: path.join(projectRoot, 'poltergeist.config.json'),
    process: {
      pid: 123,
      hostname: 'local',
      startTime: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      isActive: true,
    },
    lastBuild: {
      status: 'success',
      timestamp,
      gitHash: cleanGitHash,
      builder: 'Executable',
    },
  };

  const statePath = FileSystemUtils.getStateFilePath(projectRoot, TARGET);
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  return statePath;
}

describe('isBinaryFresh', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const dir of tempRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupMocks() {
    (childProcess.execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: any) => {
        if (typeof cmd === 'string' && cmd.includes('rev-parse')) {
          return Buffer.from(`${cleanGitHash}\n`);
        }
        if (typeof cmd === 'string' && cmd.includes('git status')) {
          return Buffer.from('');
        }
        throw new Error(`unexpected execSync command: ${cmd}`);
      }
    );
  }

  it('returns true when binary is newer than last successful build and git clean', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'polter-fresh-'));
    tempRoots.push(root);
    setupMocks();

    const buildTime = Date.now();
    writeState(root, new Date(buildTime).toISOString());

    const binPath = path.join(root, TARGET);
    writeFileSync(binPath, '#!/bin/sh\n', 'utf-8');
    utimesSync(binPath, new Date(buildTime + 2000), new Date(buildTime + 2000));

    const fresh = await isBinaryFresh(root, TARGET, binPath);
    expect(fresh).toBe(true);
  });

  it('returns false when binary is older than last build', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'polter-stale-'));
    tempRoots.push(root);
    setupMocks();

    const buildTime = Date.now();
    writeState(root, new Date(buildTime).toISOString());

    const binPath = path.join(root, TARGET);
    writeFileSync(binPath, '#!/bin/sh\n', 'utf-8');
    utimesSync(binPath, new Date(buildTime - 5000), new Date(buildTime - 5000));

    const fresh = await isBinaryFresh(root, TARGET, binPath);
    expect(fresh).toBe(false);
  });

  it('returns false when git hash does not match last build', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'polter-git-'));
    tempRoots.push(root);

    (childProcess.execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: any) => {
        if (typeof cmd === 'string' && cmd.includes('rev-parse')) {
          return Buffer.from(`deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`);
        }
        if (typeof cmd === 'string' && cmd.includes('git status')) {
          return Buffer.from('');
        }
        throw new Error(`unexpected execSync command: ${cmd}`);
      }
    );

    const buildTime = Date.now();
    writeState(root, new Date(buildTime).toISOString());

    const binPath = path.join(root, TARGET);
    writeFileSync(binPath, '#!/bin/sh\n', 'utf-8');
    utimesSync(binPath, new Date(buildTime + 1000), new Date(buildTime + 1000));

    const fresh = await isBinaryFresh(root, TARGET, binPath);
    expect(fresh).toBe(false);
  });
});

describe('resolveBinaryPath', () => {
  it('finds the target binary in common locations', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'polter-bin-'));
    const binPath = path.join(root, TARGET);
    writeFileSync(binPath, 'echo hi');

    const resolved = resolveBinaryPath(TARGET, root);
    expect(resolved).toBe(binPath);

    rmSync(root, { recursive: true, force: true });
  });
});
