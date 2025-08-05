// CMake library builder
import { existsSync } from 'fs';
import { join } from 'path';
import type { CMakeLibraryTarget } from '../types.js';
import { CMakeBuilder } from './cmake-builder.js';

export class CMakeLibraryBuilder extends CMakeBuilder<CMakeLibraryTarget> {
  protected async postBuild(): Promise<void> {
    // Try to find the output library
    const outputPath = this.findLibrary();

    if (!outputPath) {
      throw new Error(`Could not find built library for target: ${this.target.targetName}`);
    }

    this.logger.info(`[${this.target.name}] CMake library built: ${outputPath}`);
  }

  private findLibrary(): string | undefined {
    // If output path is specified, check there first
    if (this.target.outputPath) {
      const fullPath = join(this.projectRoot, this.target.outputPath);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    // Determine library file extensions based on platform and type
    const libName = this.target.targetName;
    const isStatic = this.target.libraryType === 'static';

    let prefix = '';
    let extensions: string[] = [];

    if (process.platform === 'win32') {
      prefix = '';
      extensions = isStatic ? ['.lib'] : ['.dll', '.lib']; // .lib for import library
    } else if (process.platform === 'darwin') {
      prefix = 'lib';
      extensions = isStatic ? ['.a'] : ['.dylib', '.so'];
    } else {
      prefix = 'lib';
      extensions = isStatic ? ['.a'] : ['.so'];
    }

    const buildType = this.getBuildType();

    // Search paths for libraries
    const searchPaths: string[] = [];

    for (const ext of extensions) {
      const fileName = `${prefix}${libName}${ext}`;

      searchPaths.push(
        // Direct build directory
        join(this.buildDirectory, fileName),
        // Build type subdirectory
        join(this.buildDirectory, buildType, fileName),
        // Common library directories
        join(this.buildDirectory, 'lib', fileName),
        join(this.buildDirectory, 'lib', buildType, fileName),
        // Windows DLL locations
        join(this.buildDirectory, 'bin', fileName),
        join(this.buildDirectory, 'bin', buildType, fileName),
        // Source-relative paths
        join(this.buildDirectory, 'src', fileName)
      );
    }

    for (const path of searchPaths) {
      const fullPath = join(this.projectRoot, path);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    return undefined;
  }

  public getOutputInfo(): string | undefined {
    return this.findLibrary();
  }

  protected getBuilderName(): string {
    const libType = this.target.libraryType === 'static' ? 'Static' : 'Shared';
    return `CMake-${libType}Library/${this.getGenerator()}`;
  }
}
