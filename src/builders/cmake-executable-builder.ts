// CMake executable builder
import { existsSync } from 'fs';
import { join } from 'path';
import type { CMakeExecutableTarget } from '../types.js';
import { CMakeBuilder } from './cmake-builder.js';

export class CMakeExecutableBuilder extends CMakeBuilder<CMakeExecutableTarget> {
  protected async postBuild(): Promise<void> {
    // Try to find the output executable
    const outputPath = this.findExecutable();

    if (!outputPath) {
      throw new Error(`Could not find built executable for target: ${this.target.targetName}`);
    }

    this.logger.info(`[${this.target.name}] CMake executable built: ${outputPath}`);
  }

  private findExecutable(): string | undefined {
    // If output path is specified, check there first
    if (this.target.outputPath) {
      const fullPath = join(this.projectRoot, this.target.outputPath);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    // Common output locations for executables
    const buildType = this.getBuildType();
    const targetName = this.target.targetName;
    const exeExt = process.platform === 'win32' ? '.exe' : '';

    const searchPaths = [
      // Direct build directory
      join(this.buildDirectory, `${targetName}${exeExt}`),
      // Build type subdirectory (multi-config generators)
      join(this.buildDirectory, buildType, `${targetName}${exeExt}`),
      // Common subdirectories
      join(this.buildDirectory, 'bin', `${targetName}${exeExt}`),
      join(this.buildDirectory, 'bin', buildType, `${targetName}${exeExt}`),
      // Source-relative paths
      join(this.buildDirectory, 'src', `${targetName}${exeExt}`),
      join(this.buildDirectory, 'app', `${targetName}${exeExt}`),
      join(this.buildDirectory, 'examples', `${targetName}${exeExt}`),
    ];

    for (const path of searchPaths) {
      const fullPath = join(this.projectRoot, path);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    return undefined;
  }

  public getOutputInfo(): string | undefined {
    return this.findExecutable();
  }

  protected getBuilderName(): string {
    return `CMake-Executable/${this.getGenerator()}`;
  }
}
