import type { IStateManager } from '../interfaces.js';
import type { Logger } from '../logger.js';
import type { PoltergeistState } from '../state.js';
import type { PoltergeistConfig, Target } from '../types.js';

export interface StatusPresenterDeps {
  logger: Logger;
  stateManager: IStateManager;
}

export class StatusPresenter {
  constructor(private readonly deps: StatusPresenterDeps) {}

  public async getStatus(
    config: PoltergeistConfig,
    targetStates: Map<
      string,
      {
        target: Target;
        watching: boolean;
        pendingFiles: Set<string>;
        lastBuild?: PoltergeistState['lastBuild'];
      }
    >
  ): Promise<Record<string, unknown>> {
    const status: Record<string, unknown> = {};

    const deriveStatus = (stateFile?: PoltergeistState, fallback?: string): string => {
      if (!stateFile) return fallback ?? 'unknown';
      const hasBuild = Boolean(stateFile.lastBuild);
      if (hasBuild) {
        return stateFile.lastBuild?.status ?? fallback ?? 'unknown';
      }
      const start = Date.parse(stateFile.process.startTime ?? '') || 0;
      const ageMs = Date.now() - start;
      const graceMs = 30_000; // 30s grace for startup
      if (stateFile.process.isActive && ageMs > graceMs) {
        return 'failure';
      }
      return fallback ?? (stateFile.process.isActive ? 'watching' : 'stopped');
    };

    // All targets status
    for (const target of config.targets) {
      const state = targetStates.get(target.name);
      const stateFile = await this.deps.stateManager.readState(target.name);

      if (state && stateFile) {
        status[target.name] = {
          status: deriveStatus(stateFile, state.watching ? 'watching' : 'idle'),
          enabled: target.enabled,
          type: target.type,
          process: stateFile.process,
          lastBuild: stateFile.lastBuild || state.lastBuild,
          appInfo: stateFile.appInfo,
          pendingFiles: state.pendingFiles.size,
          buildStats: stateFile.buildStats,
          buildCommand: target.buildCommand,
          postBuild: stateFile.postBuildResults
            ? Object.values(stateFile.postBuildResults)
            : undefined,
        };
      } else if (stateFile) {
        status[target.name] = {
          status: deriveStatus(stateFile),
          enabled: target.enabled,
          type: target.type,
          process: stateFile.process,
          lastBuild: stateFile.lastBuild,
          appInfo: stateFile.appInfo,
          buildStats: stateFile.buildStats,
          postBuild: stateFile.postBuildResults
            ? Object.values(stateFile.postBuildResults)
            : undefined,
          buildCommand: target.buildCommand,
        };
      } else {
        status[target.name] = {
          status: 'not running',
          enabled: target.enabled,
          type: target.type,
        };
      }
    }

    return status;
  }
}
