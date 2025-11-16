import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayLogs, parseLogLine, readLogEntries } from '../../src/cli/logging.js';

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

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterEach(() => {
  logSpy.mockClear();
  errorSpy.mockClear();
});

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

  it('parses plain text and JSON via parseLogLine helper', () => {
    const plain = parseLogLine('2024-01-01T00:00:00Z INFO : [demo] Build started', 'demo').entry;
    expect(plain).toMatchObject({
      level: 'info',
      message: 'Build started',
      target: 'demo',
    });

    const json = parseLogLine(
      '{"timestamp":"t","level":"error","message":"nope","target":"demo"}',
      'demo'
    ).entry;
    expect(json).toMatchObject({ level: 'error', message: 'nope', target: 'demo' });
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

  it('ignores lines that do not parse', async () => {
    const file = createTempLogFile('not-a-log-line');
    const entries = await readLogEntries(file, 'demo');
    cleanup(file);
    expect(entries).toHaveLength(0);
  });
});

describe('displayLogs', () => {
  it('prints JSON array when json flag is set', async () => {
    const file = createTempLogFile('2024-01-01T00:00:00Z INFO : [demo] Build started');

    await displayLogs(file, { target: 'demo', lines: '10', json: true });
    cleanup(file);

    expect(logSpy).toHaveBeenCalled();
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload[0]).toMatchObject({ target: 'demo', message: 'Build started' });
  });

  it('warns when no logs are found', async () => {
    const file = createTempLogFile('');
    await displayLogs(file, { target: 'demo', lines: '10' });
    cleanup(file);

    const combined = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(combined).toContain('No logs found');
  });
});
