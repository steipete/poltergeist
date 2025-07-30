// Test to verify old config format triggers proper error

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { ConfigLoader, ConfigurationError } from '../src/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Config Migration', () => {
  it('should reject old configuration format', () => {
    const oldConfigPath = resolve(__dirname, 'fixtures/old-config.json');
    const loader = new ConfigLoader(oldConfigPath);

    expect(() => loader.loadConfig()).toThrow(ConfigurationError);
    expect(() => loader.loadConfig()).toThrow('Old configuration format detected');
  });

  it('should accept new configuration format', () => {
    const newConfigPath = resolve(__dirname, 'fixtures/test-config.json');
    const loader = new ConfigLoader(newConfigPath);

    const config = loader.loadConfig();
    expect(config.targets).toHaveLength(2);
    expect(config.targets[0].name).toBe('test-cli');
    expect(config.targets[0].type).toBe('executable');
    expect(config.targets[1].name).toBe('test-app');
    expect(config.targets[1].type).toBe('app-bundle');
  });

  it('should reject duplicate target names', () => {
    // This would need a fixture with duplicate names
    // For now, we'll create it inline
    const _duplicateConfig = {
      targets: [
        {
          name: 'my-target',
          type: 'executable',
          enabled: true,
          buildCommand: 'echo test',
          outputPath: './out1',
          watchPaths: ['src/**/*.js'],
        },
        {
          name: 'my-target', // Duplicate name
          type: 'executable',
          enabled: true,
          buildCommand: 'echo test2',
          outputPath: './out2',
          watchPaths: ['lib/**/*.js'],
        },
      ],
    };

    // We'd need to test this with a temp file or mock
    // For now, this is a placeholder
  });
});
