import type { TargetState } from './target-state.js';

interface DebouncedBuildSchedulerOpts {
  defaultDelayMs: number;
  buildTarget: (targetName: string, files: string[], state: TargetState) => void;
}

/**
 * Handles non-queue debounce logic for file changes.
 */
export class DebouncedBuildScheduler {
  private readonly defaultDelayMs: number;
  private readonly buildTarget: (targetName: string, files: string[], state: TargetState) => void;

  constructor(opts: DebouncedBuildSchedulerOpts) {
    this.defaultDelayMs = opts.defaultDelayMs;
    this.buildTarget = opts.buildTarget;
  }

  public schedule(
    changedFiles: string[],
    targetNames: string[],
    targetStates: Map<string, TargetState>
  ): void {
    for (const targetName of targetNames) {
      const state = targetStates.get(targetName);
      if (!state) continue;

      for (const file of changedFiles) {
        state.pendingFiles.add(file);
      }

      if (state.buildTimer) {
        clearTimeout(state.buildTimer);
      }

      const delay = state.target.settlingDelay || this.defaultDelayMs;

      state.buildTimer = setTimeout(async () => {
        await this.buildTarget(targetName, Array.from(state.pendingFiles), state);
        state.buildTimer = undefined;
      }, delay);
    }
  }
}
