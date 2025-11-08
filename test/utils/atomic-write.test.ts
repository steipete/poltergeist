import { promises as fsPromises } from 'node:fs';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import writeFileAtomic, { writeFileAtomicSync } from '../../src/utils/atomic-write.js';

describe('atomic write utilities', () => {
  let tempDir: string;
  const syncDirs: string[] = [];

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    while (syncDirs.length > 0) {
      const dir = syncDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    vi.restoreAllMocks();
  });

  it('writes data atomically and reports temp file', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'atomic-test-'));
    const filePath = path.join(tempDir, 'output.txt');
    const tmpFiles: string[] = [];

    await writeFileAtomic(filePath, 'hello world', {
      tmpfileCreated: (tmpfile) => tmpFiles.push(tmpfile),
    });

    const contents = await readFile(filePath, 'utf8');
    expect(contents).toBe('hello world');
    expect(tmpFiles).toHaveLength(1);
    expect(tmpFiles[0]).toContain(tempDir);
    const remaining = await readdir(tempDir);
    expect(remaining).toContain('output.txt');
    expect(remaining.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('retries rename when encountering transient Windows errors', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'atomic-retry-'));
    const filePath = path.join(tempDir, 'retry.txt');
    const busyError = Object.assign(new Error('busy'), { code: 'EBUSY' });
    const originalRename = fsPromises.rename.bind(fsPromises);
    const renameSpy = vi
      .spyOn(fsPromises, 'rename')
      .mockImplementationOnce(async () => {
        throw busyError;
      })
      .mockImplementation(originalRename);

    await writeFileAtomic(filePath, 'with retries');

    expect(renameSpy).toHaveBeenCalledTimes(2);
    const contents = await readFile(filePath, 'utf8');
    expect(contents).toBe('with retries');
  });

  it('writes synchronously with buffer data', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'atomic-sync-'));
    syncDirs.push(dir);
    const filePath = path.join(dir, 'sync.bin');

    writeFileAtomicSync(filePath, Buffer.from([1, 2, 3]), { mode: 0o600 });

    const contents = readFileSync(filePath);
    expect([...contents]).toEqual([1, 2, 3]);
    const stats = statSync(filePath);
    expect((stats.mode & 0o777).toString(8)).toBe('600');
  });

  it('propagates unrecoverable rename errors and cleans up temp files', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'atomic-perm-'));
    const filePath = path.join(tempDir, 'no-permission.txt');
    let tmpPath: string | undefined;
    const originalRename = fsPromises.rename.bind(fsPromises);

    const renameSpy = vi
      .spyOn(fsPromises, 'rename')
      .mockImplementationOnce(async () => {
        const error = Object.assign(new Error('permission'), { code: 'EACCES' });
        throw error;
      })
      .mockImplementation(originalRename);

    await expect(
      writeFileAtomic(filePath, 'data', {
        tmpfileCreated: (tmpfile) => {
          tmpPath = tmpfile;
        },
      })
    ).rejects.toThrow('permission');

    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(tmpPath).toBeDefined();
    if (tmpPath) {
      await expect(readFile(tmpPath, 'utf8')).rejects.toThrow();
    }
  });

  it('cleans up temp file when write fails', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'atomic-fail-'));
    const filePath = path.join(tempDir, 'fail.txt');
    const writeSpy = vi.spyOn(fsPromises, 'writeFile').mockRejectedValue(new Error('disk full'));
    const tmpFiles: string[] = [];

    await expect(
      writeFileAtomic(filePath, 'data', {
        tmpfileCreated: (tmpfile) => tmpFiles.push(tmpfile),
      })
    ).rejects.toThrow('disk full');

    expect(tmpFiles).toHaveLength(1);
    await expect(readFile(tmpFiles[0], 'utf8')).rejects.toThrow();
    expect(writeSpy).toHaveBeenCalled();
  });
});
