#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function verifyMinimum(loadCommands, maximum) {
  const match = loadCommands.match(/\bcmd LC_BUILD_VERSION\s+cmdsize \d+\s+platform (?:1|macos)\s+minos ([\d.]+)/i)
    ?? loadCommands.match(/\bcmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([\d.]+)/);
  if (!match) throw new Error('Missing macOS deployment target');
  const actual = match[1].split('.').map(Number);
  const allowed = maximum.split('.').map(Number);
  for (let i = 0; i < Math.max(actual.length, allowed.length); i++) {
    const difference = (actual[i] ?? 0) - (allowed[i] ?? 0);
    if (difference > 0) throw new Error(`Deployment target ${match[1]} exceeds documented macOS ${maximum}`);
    if (difference < 0) break;
  }
  return match[1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [binary, maximum] = process.argv.slice(2);
  if (!binary || !/^\d+\.\d+(\.\d+)?$/.test(maximum ?? '')) throw new Error('Usage: verify-macos-target.mjs <binary> <maximum-minos>');
  const architectures = execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/);
  for (const required of ['arm64', 'x86_64']) {
    if (!architectures.includes(required)) throw new Error(`Missing ${required} slice: ${binary}`);
  }
  for (const arch of architectures) {
    const commands = execFileSync('otool', ['-arch', arch, '-l', binary], { encoding: 'utf8' });
    console.log(`${binary} ${arch}: minos ${verifyMinimum(commands, maximum)} (maximum ${maximum})`);
  }
}
