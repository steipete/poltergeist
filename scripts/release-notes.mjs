#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function releaseNotes(changelog, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a stable release version');
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => line.startsWith(`## [${version}] - `));
  if (start < 0) throw new Error(`Missing changelog section for ${version}`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const section = lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();
  if (!section.startsWith('**Highlights:**') || !section.includes('\n- ')) throw new Error('Release requires highlights and changelog entries');
  return `${section}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), process.argv[2]));
}
