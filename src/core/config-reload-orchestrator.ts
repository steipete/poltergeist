import type { PoltergeistConfig } from '../types.js';
import { type ConfigChanges, detectConfigChanges } from '../utils/config-diff.js';
import { ConfigurationManager } from '../utils/config-manager.js';

interface ConfigReloadDeps {
  configPath?: string;
  loadConfig?: (path: string) => Promise<PoltergeistConfig>;
}

export class ConfigReloadOrchestrator {
  private readonly configPath?: string;
  private readonly loader: (path: string) => Promise<PoltergeistConfig>;

  constructor(deps: ConfigReloadDeps) {
    this.configPath = deps.configPath;
    this.loader = deps.loadConfig ?? ConfigurationManager.loadConfigFromPath;
  }

  public async reloadConfig(
    current: PoltergeistConfig
  ): Promise<{ config: PoltergeistConfig; changes: ConfigChanges } | null> {
    if (!this.configPath) return null;
    const newConfig = await this.loader(this.configPath);
    const changes = detectConfigChanges(current, newConfig);
    return { config: newConfig, changes };
  }
}
