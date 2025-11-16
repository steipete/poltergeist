import type { BaseBuilder } from '../builders/index.js';
import type { PostBuildRunner } from '../post-build/post-build-runner.js';
import type { ExecutableRunner } from '../runners/executable-runner.js';
import type { BuildStatus, Target } from '../types.js';

export interface TargetState {
  target: Target;
  builder: BaseBuilder;
  watching: boolean;
  lastBuild?: BuildStatus;
  pendingFiles: Set<string>;
  buildTimer?: NodeJS.Timeout;
  runner?: ExecutableRunner;
  postBuildRunner?: PostBuildRunner;
}
