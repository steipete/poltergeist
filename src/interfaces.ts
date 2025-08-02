// Interfaces for dependency injection and better testability

import type { BaseBuilder } from './builders/index.js';
import type { Logger } from './logger.js';
import type { BuildNotifier } from './notifier.js';
import type { PoltergeistState } from './state.js';
import type { BuildStatus, Target } from './types.js';

/**
 * Interface for Watchman client operations
 */
export interface IWatchmanClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  watchProject(projectPath: string): Promise<void>;
  subscribe(
    root: string,
    name: string,
    config: {
      expression: Array<string | Array<string>>;
      fields: string[];
    },
    callback: (files: Array<{ name: string; exists: boolean; type?: string }>) => void,
    exclusionExpressions?: Array<[string, string[]]>
  ): Promise<void>;
  unsubscribe(subscriptionName: string): Promise<void>;
  isConnected(): boolean;
}

/**
 * Interface for state management operations
 */
export interface IStateManager {
  initializeState(target: Target): Promise<PoltergeistState>;
  readState(targetName: string): Promise<PoltergeistState | null>;
  updateState(targetName: string, updates: Partial<PoltergeistState>): Promise<void>;
  updateBuildStatus(targetName: string, buildStatus: BuildStatus): Promise<void>;
  removeState(targetName: string): Promise<void>;
  isLocked(targetName: string): Promise<boolean>;
  discoverStates(): Promise<Record<string, Partial<PoltergeistState>>>;
  startHeartbeat(): void;
  stopHeartbeat(): void;
  cleanup(): Promise<void>;
}

/**
 * Interface for builder factory operations
 */
export interface IBuilderFactory {
  createBuilder(
    target: Target,
    projectRoot: string,
    logger: Logger,
    stateManager?: IStateManager
  ): BaseBuilder;
}

/**
 * Dependencies that must be injected into Poltergeist
 */
export interface PoltergeistDependencies {
  watchmanClient?: IWatchmanClient;
  stateManager: IStateManager;
  builderFactory: IBuilderFactory;
  notifier?: BuildNotifier;
}
