import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyMinimum } from './verify-macos-target.mjs';
import { releaseNotes } from './release-notes.mjs';

const commands = version => `cmd LC_BUILD_VERSION\n cmdsize 32\n platform 1\n minos ${version}\n sdk 26.5`;
test('deployment target rejects a runner SDK floor above documented support', () => {
  assert.throws(() => verifyMinimum(commands('15.0'), '13.0'), /exceeds/);
  assert.equal(verifyMinimum(commands('13.0'), '13.0'), '13.0');
  assert.equal(verifyMinimum(commands('12.6'), '13.0'), '12.6');
  assert.throws(() => verifyMinimum(commands('13.1'), '13.0'), /exceeds/);
  assert.throws(() => verifyMinimum(commands('13.0.1'), '13.0'), /exceeds/);
  assert.throws(() => verifyMinimum('', '13.0'), /Missing/);
  assert.throws(() => verifyMinimum(commands('13.0').replace('platform 1', 'platform 2'), '13.0'), /Missing/);
  assert.equal(verifyMinimum('cmd LC_VERSION_MIN_MACOSX\n cmdsize 16\n version 10.15\n sdk 11.0', '13.0'), '10.15');
});
test('release notes preserve all bullets and exclude adjacent releases', () => {
  const text = '# Changelog\n\n## [Unreleased]\n\n## [2.1.8] - 2026-09-30\n\n**Highlights:** Fixed crashes.\n\n- First fix.\n- Second fix.\n\n## [2.1.7] - 2026-09-07\n\n- Older fix.\n';
  assert.equal(releaseNotes(text, '2.1.8'), '**Highlights:** Fixed crashes.\n\n- First fix.\n- Second fix.\n');
  assert.throws(() => releaseNotes(text, '2.1.9'), /Missing/);
  assert.throws(() => releaseNotes(text, '2.1.7'), /highlights/);
});
