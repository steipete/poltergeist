import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readLogEntries } from '../../src/cli/logging.js';

const createTempLogFile = (content: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poltergeist-log-'));
  const file = path.join(dir, 'build.log');
  writeFileSync(file, content, 'utf-8');
  return file;
};

const cleanup = (filePath: string) => {
  const dir = path.dirname(filePath);
  rmSync(dir, { recursive: true, force: true });
};

describe('readLogEntries', () => {
  it('parses plain text log lines', async () => {
    const file = createTempLogFile(
      [
        '2024-01-01T00:00:00.000Z INFO : [demo] Build started',
        '2024-01-01T00:00:01.000Z DEBUG: [demo] Compiling',
      ].join('\n')
    );

    const entries = await readLogEntries(file, 'demo');
    cleanup(file);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      level: 'info',
      target: 'demo',
      message: 'Build started',
    });
  });

  it('supports legacy JSON lines and respects maxLines', async () => {
    const jsonLine = JSON.stringify({
      timestamp: '2024-01-01T00:00:02.000Z',
      level: 'error',
      message: 'Failed',
      target: 'demo',
    });
    const file = createTempLogFile(
      [
        '2024-01-01T00:00:00.000Z INFO : [demo] Build started',
        jsonLine,
        '2024-01-01T00:00:03.000Z INFO : [demo] Retrying',
      ].join('\n')
    );

    const entries = await readLogEntries(file, 'demo', 2);
    cleanup(file);

    expect(entries).toHaveLength(2);
    // The last two lines should be returned when maxLines is 2
    expect(entries[0].message).toBe('Failed');
    expect(entries[1].message).toBe('Retrying');
  });
});
