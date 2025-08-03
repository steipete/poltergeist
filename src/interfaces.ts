// Interfaces for dependency injection and better testability

import type { BaseBuilder } from './builders/index.js';
import type { Logger } from './logger.js';
import type { BuildNotifier } from './notifier.js';
import type { PoltergeistState } from './state.js';
import type { BuildStatus, PoltergeistConfig, Target } from './types.js';

/**
 * Interface for Watchman client operations.
 * Abstracts Facebook's Watchman file watching service for testability.
 * Handles project subscriptions and file change notifications.
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
 * Interface for state management operations.
 * Handles persistent state files for inter-process coordination.
 * Manages build status, process liveness, and target metadata.
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
 * Interface for builder factory operations.
 * Creates appropriate builder instances based on target type.
 * Supports executable, app-bundle, library, framework, test, docker, and custom targets.
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
 * Dependencies that must be injected into Poltergeist for operation.
 * Uses dependency injection pattern for better testability and modularity.
 * All dependencies except stateManager and builderFactory are optional.
 */
export interface PoltergeistDependencies {
  watchmanClient?: IWatchmanClient;
  stateManager: IStateManager;
  builderFactory: IBuilderFactory;
  notifier?: BuildNotifier;
  watchmanConfigManager?: IWatchmanConfigManager;
}

/**
 * Interface for Watchman configuration management.
 * Handles automatic .watchmanconfig generation with smart exclusions.
 * Optimizes file watching performance based on project type and size.
 */
export interface IWatchmanConfigManager {
  /** Ensures .watchmanconfig is current with optimal exclusions */
  ensureConfigUpToDate(config: PoltergeistConfig): Promise<void>;
  /** Analyzes project and suggests performance optimizations */
  suggestOptimizations(): Promise<string[]>;
  /** Converts exclusion rules to Watchman expression format */
  createExclusionExpressions(config: PoltergeistConfig): Array<[string, string[]]>;
  /** Normalizes watch patterns to be more lenient */
  normalizeWatchPattern(pattern: string): string;
  /** Validates glob pattern syntax */
  validateWatchPattern(pattern: string): void;
}
