import type { TargetState } from "./target-state.js";

/** Attempt every independent cleanup step before reporting retirement errors. */
export async function completeCleanup(
  steps: Iterable<() => void | Promise<void>>,
  message: string,
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      if (error instanceof AggregateError) errors.push(...error.errors);
      else errors.push(error);
    }
  }
  if (errors.length) {
    const details = errors.map((error) => (error instanceof Error ? error.message : String(error)));
    throw new AggregateError(errors, `${message}: ${details.join("; ")}`);
  }
}

/** Keep the live Map iteration: config reload may add a target while stop waits. */
export function stopAllTargets(states: Map<string, TargetState>): Promise<void> {
  function* steps(): Generator<() => void | Promise<void>> {
    for (const state of states.values()) yield () => stopTargetResources(state);
    // Clear in the same iteration, without an await between its end and clear.
    yield () => {
      states.clear();
    };
  }
  return completeCleanup(steps(), "Target shutdown cleanup failed");
}

export function stopTargetResources(state: TargetState): Promise<void> {
  return completeCleanup(
    [
      () => {
        if (state.buildTimer) clearTimeout(state.buildTimer);
        state.buildTimer = undefined;
      },
      () => state.runner?.stop(),
      () => state.postBuildRunner?.stop(),
      () => state.builder.stop(),
    ],
    `Failed to stop target ${state.target.name}`,
  );
}
