import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  augmentConfigWithDetectedTargets,
  generateDefaultConfig,
  guessBundleId,
} from '../../src/cli/init-helpers.js';
import type { PoltergeistConfig } from '../../src/types.js';

describe('generateDefaultConfig', () => {
  it('creates sensible defaults for common project types', () => {
    const nodeConfig = generateDefaultConfig('node');
    expect(nodeConfig.targets[0]).toMatchObject({
      name: 'dev',
      type: 'executable',
      buildCommand: 'npm run build',
    });

    const rustConfig = generateDefaultConfig('rust');
    expect(rustConfig.targets[0].watchPaths).toContain('Cargo.toml');
  });
});

describe('guessBundleId', () => {
  it('derives bundle ids for macOS and iOS heuristically', () => {
    expect(guessBundleId('MyApp', '/proj/MyApp.xcodeproj')).toBe('com.example.myapp');
    expect(guessBundleId('MyApp iOS', '/proj/MyApp/ios/MyApp.xcodeproj')).toBe(
      'com.example.myapp.ios'
    );
  });
});

describe('augmentConfigWithDetectedTargets', () => {
  it('adds a Makefile target when no enabled targets exist', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'poltergeist-make-'));
    writeFileSync(
      path.join(tmpDir, 'Makefile'),
      'TARGET=demo\n\ndemo:\n\t@echo building\n',
      'utf-8'
    );

    const config: PoltergeistConfig = {
      version: '1.0',
      projectType: 'node',
      targets: [],
    };

    const summaries = await augmentConfigWithDetectedTargets(tmpDir, config);

    rmSync(tmpDir, { recursive: true, force: true });

    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]).toMatchObject({
      name: 'demo',
      buildCommand: 'make demo',
      enabled: true,
    });
    expect(summaries).toEqual([{ name: 'demo', type: 'executable', reason: 'makefile' }]);
  });

  it('can skip auto-add when disabled', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'poltergeist-skip-'));
    writeFileSync(path.join(tmpDir, 'Makefile'), 'all:\n\t@echo skip\n', 'utf-8');

    const config: PoltergeistConfig = {
      version: '1.0',
      projectType: 'node',
      targets: [],
    };

    const summaries = await augmentConfigWithDetectedTargets(tmpDir, config, {
      allowAutoAdd: false,
    });

    rmSync(tmpDir, { recursive: true, force: true });

    expect(config.targets).toHaveLength(0);
    expect(summaries).toEqual([]);
  });

  it('detects python targets when enabled', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'poltergeist-py-'));
    writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[build-system]\n', 'utf-8');
    writeFileSync(path.join(tmpDir, 'main.py'), 'print("hi")', 'utf-8');

    const config: PoltergeistConfig = {
      version: '1.0',
      projectType: 'python',
      targets: [],
    };

    const summaries = await augmentConfigWithDetectedTargets(tmpDir, config);

    rmSync(tmpDir, { recursive: true, force: true });

    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]).toMatchObject({ name: 'tests', type: 'executable' });
    expect(summaries).toEqual([{ name: 'tests', type: 'executable', reason: 'python' }]);
  });
});
