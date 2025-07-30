// Builder factory and exports

import type { Logger } from '../logger.js';
import type { StateManager } from '../state.js';
import type { Target } from '../types.js';
import { AppBundleBuilder } from './app-bundle-builder.js';
import type { BaseBuilder } from './base-builder.js';
import { ExecutableBuilder } from './executable-builder.js';

export * from './app-bundle-builder.js';
export * from './base-builder.js';
export * from './executable-builder.js';

export function createBuilder(
  target: Target,
  projectRoot: string,
  logger: Logger,
  stateManager: StateManager
): BaseBuilder {
  switch (target.type) {
    case 'executable':
      return new ExecutableBuilder(target, projectRoot, logger, stateManager);

    case 'app-bundle':
      return new AppBundleBuilder(target, projectRoot, logger, stateManager);

    case 'library':
    case 'framework':
    case 'test':
    case 'docker':
      // These would be implemented in their own files
      throw new Error(`Builder for target type '${target.type}' not yet implemented`);

    case 'custom':
      // Custom targets would use a plugin system
      throw new Error('Custom target builders not yet implemented');

    default: {
      // Type assertion to handle exhaustive check
      const exhaustiveCheck: never = target;
      throw new Error(`Unknown target type: ${(exhaustiveCheck as Target).type}`);
    }
  }
}

/**
 * Get the builder class for a target type (for advanced usage)
 */
export function getBuilderClass(targetType: Target['type']): typeof BaseBuilder {
  switch (targetType) {
    case 'executable':
      return ExecutableBuilder as typeof BaseBuilder;

    case 'app-bundle':
      return AppBundleBuilder as typeof BaseBuilder;

    default:
      throw new Error(`Unknown target type: ${targetType}`);
  }
}

// Export for backward compatibility
export const BuilderFactory = {
  createBuilder,
  getBuilderClass,
};
