import { describe, expect, it, vi } from 'vitest';
import { ConfigReloadOrchestrator } from '../src/core/config-reload-orchestrator.js';
import type { PoltergeistConfig } from '../src/types.js';

const baseConfig: PoltergeistConfig = {
  version: '1.0',
  projectType: 'node',
  targets: [],
  watchman: {
    useDefaultExclusions: true,
    excludeDirs: [],
    projectType: 'node',
    maxFileEvents: 10000,
    recrawlThreshold: 5,
    settlingDelay: 1000,
  },
};

describe('ConfigReloadOrchestrator', () => {
  it('returns null when no configPath is provided', async () => {
    const orchestrator = new ConfigReloadOrchestrator({});
    const result = await orchestrator.reloadConfig(baseConfig);
    expect(result).toBeNull();
  });

  it('loads config and detects changes', async () => {
    const loader = vi.fn().mockResolvedValue({
      ...baseConfig,
      targets: [{ name: 't1', type: 'executable', enabled: true, buildCommand: 'echo ok' }],
    });
    const orchestrator = new ConfigReloadOrchestrator({
      configPath: '/config',
      loadConfig: loader,
    });

    const result = await orchestrator.reloadConfig(baseConfig);
    expect(loader).toHaveBeenCalledWith('/config');
    expect(result?.changes.targetsAdded[0]?.name).toBe('t1');
  });
});
