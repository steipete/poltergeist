import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname, resolve } from 'path';
import type { ScriptEvent } from './types.js';

const DEFAULT_MAX_BYTES = 200 * 1024; // 200 KB

export interface ScriptEventLogOptions {
  path?: string;
  maxBytes?: number;
  maxFiles?: number;
}

/**
 * Returns a sink that writes script events as JSONL to a file.
 * When the file exceeds the size cap, it is truncated by deletion.
 */
export function createScriptEventFileSink(
  options: ScriptEventLogOptions = {}
): (event: ScriptEvent) => void {
  const path = resolve(options.path ?? '/tmp/poltergeist-script-events.log');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = Math.max(1, options.maxFiles ?? 2);

  mkdirSync(dirname(path), { recursive: true });

  return (event: ScriptEvent) => {
    try {
      appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf-8');
      if (existsSync(path) && statSync(path).size > maxBytes) {
        rotateFiles(path, maxFiles);
      }
    } catch {
      // Best-effort logging; ignore errors.
    }
  };
}

function rotateFiles(path: string, maxFiles: number): void {
  try {
    for (let idx = maxFiles - 1; idx >= 1; idx--) {
      const src = `${path}.${idx}`;
      const dest = `${path}.${idx + 1}`;
      if (existsSync(src)) {
        if (idx + 1 > maxFiles) {
          unlinkSync(src);
        } else {
          renameSync(src, dest);
        }
      }
    }
    const first = `${path}.1`;
    if (existsSync(first)) {
      unlinkSync(first);
    }
    renameSync(path, first);
  } catch {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // ignore
    }
  }
}
