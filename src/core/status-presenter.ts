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
      if (stateFile.process?.isActive) {
        const start =
          typeof stateFile.process.startTime === 'string'
            ? Date.parse(stateFile.process.startTime)
            : undefined;
        const startValid = Number.isFinite(start);
        const graceMs = 30_000;
        if (!fallback && startValid && Date.now() - (start as number) > graceMs) {
          return 'failure';
        }
        return fallback ?? 'running';
      }
      if (stateFile.lastBuild?.status) {
        return stateFile.lastBuild.status;
      }
      return fallback ?? 'stopped';
    };

    const targetsToReport =
      targetStates.size > 0
        ? config.targets.filter((t) => targetStates.has(t.name))
        : config.targets;

    // All targets status (filtered when a subset is active)
    for (const target of targetsToReport) {
      const state = targetStates.get(target.name);
      const stateFile = await this.deps.stateManager.readState(target.name);

      if (state && stateFile) {
        const targetStatus: Record<string, unknown> = {
          status: 'idle',
          enabled: target.enabled,
          type: target.type,
          process: stateFile.process,
          lastBuild: stateFile.lastBuild || state.lastBuild,
          appInfo: stateFile.appInfo,
          pendingFiles: state.pendingFiles.size,
          buildStats: stateFile.buildStats,
          buildCommand: target.buildCommand,
        };
        if (stateFile.postBuildResults) {
          targetStatus.postBuild = Object.values(stateFile.postBuildResults);
        }
        status[target.name] = targetStatus;
      } else if (stateFile) {
        const targetStatus: Record<string, unknown> = {
          status: deriveStatus(stateFile),
          enabled: target.enabled,
          type: target.type,
          process: stateFile.process,
          lastBuild: stateFile.lastBuild,
          appInfo: stateFile.appInfo,
          buildStats: stateFile.buildStats,
          buildCommand: target.buildCommand,
        };
        if (stateFile.postBuildResults) {
          targetStatus.postBuild = Object.values(stateFile.postBuildResults);
        }
        status[target.name] = targetStatus;
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
