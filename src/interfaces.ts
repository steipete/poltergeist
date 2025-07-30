// Interfaces for dependency injection and better testability
import { Target, BuildStatus } from './types.js';
import { Logger } from './logger.js';
import { BuildNotifier } from './notifier.js';
import { BaseBuilder } from './builders/index.js';
import { PoltergeistState } from './state.js';

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
      expression: any[];
      fields: string[];
    },
    callback: (files: any[]) => void
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
    stateManager?: any
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