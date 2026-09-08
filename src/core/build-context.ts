import type { BuildStatus, Target } from "../types.js";

// Keep launch configuration with the result without persisting environment values in state.
const buildTargets = new WeakMap<BuildStatus, Target>();
const buildOutputs = new WeakMap<BuildStatus, string | undefined>();

export function recordBuildOutput(result: BuildStatus, output: string | undefined): void {
  buildOutputs.set(result, output);
}

export function outputForBuild(
  result: BuildStatus,
  fallback: () => string | undefined,
): string | undefined {
  return buildOutputs.has(result) ? buildOutputs.get(result) : fallback();
}

export function recordBuildTarget(result: BuildStatus, target: Target): BuildStatus {
  buildTargets.set(result, target);
  return result;
}

export function targetForBuild(result: BuildStatus, requestedTarget: Target): Target {
  return buildTargets.get(result) ?? requestedTarget;
}
