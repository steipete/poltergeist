import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { createScriptEventFileSink } from '../../src/panel/script-event-log.js';
import type { ScriptEvent } from '../../src/panel/types.js';

const event: ScriptEvent = {
  kind: 'status',
  label: 'lint',
  exitCode: 1,
  targets: ['app'],
  timestamp: Date.now(),
};

describe('script-event-log', () => {
  it('writes JSONL and truncates when exceeding cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'script-log-'));
    const path = join(dir, 'events.log');
    const sink = createScriptEventFileSink({ path, maxBytes: 200 });

    sink(event);
    const first = readFileSync(path, 'utf-8').trim().split('\n');
    expect(first.length).toBe(1);
    expect(first[0]).toContain('"label":"lint"');

    // Force rotate by exceeding cap
    for (let i = 0; i < 50; i++) {
      sink({ ...event, timestamp: Date.now() + i });
    }
    // One more write to recreate file after truncation/rotation.
    sink({ ...event, timestamp: Date.now() + 999 });
    const contents = readFileSync(path, 'utf-8');
    expect(contents.length).toBeLessThanOrEqual(200);
    const rotated = readFileSync(`${path}.1`, 'utf-8');
    expect(rotated.length).toBeGreaterThan(0);
    // ensure older rotation slot exists after rolling again
    sink({ ...event, timestamp: Date.now() + 2000 });
    sink({ ...event, timestamp: Date.now() + 2001 });
    const rotated2 = readFileSync(`${path}.2`, 'utf-8');
    expect(rotated2.length).toBeGreaterThan(0);
  });
});
