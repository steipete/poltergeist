// Builder factory and exports
import { Target } from '../types.js';
import { Logger } from '../logger.js';
import { StateManager } from '../state.js';
import { BaseBuilder } from './base-builder.js';
import { ExecutableBuilder } from './executable-builder.js';
import { AppBundleBuilder } from './app-bundle-builder.js';

export * from './base-builder.js';
export * from './executable-builder.js';
export * from './app-bundle-builder.js';

export class BuilderFactory {
  public static createBuilder(
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
      
      default:
        throw new Error(`Unknown target type: ${(target as any).type}`);
    }
  }

  /**
   * Get the builder class for a target type (for advanced usage)
   */
  public static getBuilderClass(targetType: string): typeof BaseBuilder {
    switch (targetType) {
      case 'executable':
        return ExecutableBuilder as any;
      
      case 'app-bundle':
        return AppBundleBuilder as any;
      
      default:
        throw new Error(`Unknown target type: ${targetType}`);
    }
  }
}