// Shared typed loaders for dynamic imports used by CLI commands.
// Centralizing here keeps type-checking consistent and helps Bun compile include modules.
import type { StateManager as StateManagerType } from '../state.js';
import type { Target } from '../types.js';

type RunWrapper = typeof import('../polter.js')['runWrapper'];

export const loadDaemonManager = async (): Promise<typeof import('../daemon/daemon-manager.js')> =>
  import('../daemon/daemon-manager.js');

export const loadStateManager = async (): Promise<typeof import('../state.js')> =>
  import('../state.js');

export const loadBuilderFactory = async (): Promise<typeof import('../builders/index.js')> =>
  import('../builders/index.js');

export const loadRunWrapper = async (): Promise<RunWrapper> => {
  const { runWrapper } = await import('../polter.js');
  return runWrapper;
};

// Convenience helper for createBuilder with types attached
export const createBuilderForTarget = async (
  target: Target,
  projectRoot: string,
  logger: any,
  stateManager: InstanceType<typeof StateManagerType>
) => {
  const { createBuilder } = await loadBuilderFactory();
  return createBuilder(target, projectRoot, logger, stateManager);
};

// Convenience helper for instantiating StateManager with runtime-safe constructor handling
export const instantiateStateManager = async (
  projectRoot: string,
  logger: any
): Promise<InstanceType<typeof StateManagerType>> => {
  const { StateManager } = await loadStateManager();
  // Support both class and factory-style exports if refactored later
  if (typeof StateManager === 'function') {
    try {
      return new (
        StateManager as new (
          root: string,
          l: any
        ) => InstanceType<typeof StateManagerType>
      )(projectRoot, logger);
    } catch (_error) {
      // Fallback for factory-style default export
      return (StateManager as unknown as (root: string, l: any) => any)(projectRoot, logger);
    }
  }
  throw new Error('StateManager export is not constructible');
};
