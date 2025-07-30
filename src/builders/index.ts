// Builder factory and exports
import { Target } from '../types.js';
import { Logger } from '../logger.js';
import { BaseBuilder } from './base-builder.js';
import { ExecutableBuilder } from './executable-builder.js';
import { AppBundleBuilder } from './app-bundle-builder.js';

export * from './base-builder.js';
export * from './executable-builder.js';
export * from './app-bundle-builder.js';

export class BuilderFactory {
  public static createBuilder(target: Target, projectRoot: string, logger: Logger): BaseBuilder {
    switch (target.type) {
      case 'executable':
        return new ExecutableBuilder(target, projectRoot, logger);
      
      case 'app-bundle':
        return new AppBundleBuilder(target, projectRoot, logger);
      
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
}