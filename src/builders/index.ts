// Builder factory and exports

import { createTargetLogger, type Logger } from '../logger.js';
import type { StateManager } from '../state.js';
import type { Target } from '../types.js';
import { AppBundleBuilder } from './app-bundle-builder.js';
import type { BaseBuilder } from './base-builder.js';
import { CMakeCustomBuilder } from './cmake-custom-builder.js';
import { CMakeExecutableBuilder } from './cmake-executable-builder.js';
import { CMakeLibraryBuilder } from './cmake-library-builder.js';
import { ExecutableBuilder } from './executable-builder.js';
import { NPMBuilder } from './npm-builder.js';

export * from './app-bundle-builder.js';
export * from './base-builder.js';
export * from './cmake-builder.js';
export * from './cmake-custom-builder.js';
export * from './cmake-executable-builder.js';
export * from './cmake-library-builder.js';
export * from './executable-builder.js';
export * from './npm-builder.js';

export function createBuilder(
  target: Target,
  projectRoot: string,
  logger: Logger,
  stateManager: StateManager
): BaseBuilder {
  // Create a target-aware logger for this builder
  const targetLogger = createTargetLogger(logger, target.name);

  switch (target.type) {
    case 'executable':
      return new ExecutableBuilder(target, projectRoot, targetLogger, stateManager);

    case 'app-bundle':
      return new AppBundleBuilder(target, projectRoot, targetLogger, stateManager);

    case 'npm':
      return new NPMBuilder(target, projectRoot, targetLogger, stateManager);

    case 'cmake-executable':
      return new CMakeExecutableBuilder(target, projectRoot, targetLogger, stateManager);

    case 'cmake-library':
      return new CMakeLibraryBuilder(target, projectRoot, targetLogger, stateManager);

    case 'cmake-custom':
      return new CMakeCustomBuilder(target, projectRoot, targetLogger, stateManager);

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
