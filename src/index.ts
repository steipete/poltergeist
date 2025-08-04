/**
 * @fileoverview Poltergeist - The ghost that keeps your builds fresh
 * 
 * A universal file watcher with auto-rebuild for any language or build system.
 * Poltergeist uses Facebook's Watchman for efficient file watching and provides
 * intelligent build prioritization, concurrent execution, and seamless integration
 * with development workflows.
 * 
 * @example Basic Usage
 * ```typescript
 * import { Poltergeist, loadConfig, FactoryRegistry, StateManager } from '@steipete/poltergeist';
 * 
 * const config = await loadConfig('poltergeist.config.json');
 * const dependencies = {
 *   stateManager: new StateManager(config, './project'),
 *   builderFactory: new FactoryRegistry(),
 *   // ... other dependencies
 * };
 * const poltergeist = new Poltergeist(config, './project', dependencies);
 * 
 * await poltergeist.start();
 * ```
 * 
 * @author Peter Steinberger <steipete@gmail.com>
 * @version 1.1.0
 * @license MIT
 */

// Core engine exports
export * from './poltergeist.js';
export * from './build-queue.js';
export * from './priority-engine.js';
export * from './state.js';

// Configuration and validation
export * from './config.js';
export * from './types.js';
export * from './interfaces.js';

// File watching system
export { WatchmanClient, WatchSubscription } from './watchman.js';
export { WatchmanConfigManager } from './watchman-config.js';

// Builder system
export * from './builders/index.js';
export * from './factories.js';

// Utilities and services
export * from './logger.js';
export * from './notifier.js';
export * from './utils/build-status-manager.js';
export * from './utils/config-manager.js';
export * from './utils/process-manager.js';
export * from './utils/filesystem.js';

/**
 * @namespace Poltergeist
 * @description Main namespace for all Poltergeist functionality
 */
