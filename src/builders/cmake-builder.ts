// CMake builder base class
import { existsSync } from 'fs';
import { join } from 'path';
import type { CMakeCustomTarget, CMakeExecutableTarget, CMakeLibraryTarget } from '../types.js';
import { BaseBuilder } from './base-builder.js';

export type CMakeTarget = CMakeExecutableTarget | CMakeLibraryTarget | CMakeCustomTarget;

export abstract class CMakeBuilder<T extends CMakeTarget = CMakeTarget> extends BaseBuilder<T> {
  protected buildDirectory: string;
  protected needsConfigure: boolean = false;

  constructor(
    target: T,
    projectRoot: string,
    logger: import('../logger.js').Logger,
    stateManager: import('../state.js').StateManager
  ) {
    super(target, projectRoot, logger, stateManager);
    this.buildDirectory = this.getBuildDirectory();
  }

  protected getBuildDirectory(): string {
    // Check for existing build directories
    const commonBuildDirs = ['build', '_build', 'cmake-build-debug', 'cmake-build-release'];
    for (const dir of commonBuildDirs) {
      const fullPath = join(this.projectRoot, dir);
      if (existsSync(join(fullPath, 'CMakeCache.txt'))) {
        return dir;
      }
    }
    // Default to 'build'
    return 'build';
  }

  protected getGenerator(): string {
    return this.target.generator || this.detectGenerator();
  }

  protected detectGenerator(): string {
    // Check if Ninja is available
    try {
      const { execSync } = require('child_process');
      execSync('ninja --version', { stdio: 'ignore' });
      return 'Ninja';
    } catch {
      // Fallback to platform defaults
      if (process.platform === 'win32') {
        return 'Visual Studio 17 2022';
      } else if (process.platform === 'darwin') {
        return 'Unix Makefiles'; // Xcode generator can be problematic for automation
      } else {
        return 'Unix Makefiles';
      }
    }
  }

  protected getBuildType(): string {
    return this.target.buildType || 'Debug';
  }

  protected getCMakeArgs(): string[] {
    const args: string[] = [];

    // Add build type for single-config generators
    const generator = this.getGenerator();
    if (!generator.includes('Visual Studio') && !generator.includes('Xcode')) {
      args.push(`-DCMAKE_BUILD_TYPE=${this.getBuildType()}`);
    }

    // Add custom arguments
    if (this.target.cmakeArgs) {
      args.push(...this.target.cmakeArgs);
    }

    return args;
  }

  protected async preBuild(changedFiles: string[]): Promise<void> {
    // Check if we need to reconfigure
    this.needsConfigure = this.shouldReconfigure(changedFiles);

    if (this.needsConfigure) {
      this.logger.info(`[${this.target.name}] CMake configuration changed, reconfiguring...`);
      await this.configure();
    }
  }

  protected shouldReconfigure(changedFiles: string[]): boolean {
    // Always configure if build directory doesn't exist
    if (!existsSync(join(this.projectRoot, this.buildDirectory, 'CMakeCache.txt'))) {
      return true;
    }

    // Reconfigure if CMake files changed
    return changedFiles.some(
      (file) =>
        file.endsWith('CMakeLists.txt') ||
        file.includes('/cmake/') ||
        file.endsWith('.cmake') ||
        file.endsWith('CMakePresets.json')
    );
  }

  protected async configure(): Promise<void> {
    const args = [
      '-B',
      this.buildDirectory,
      '-S',
      '.',
      '-G',
      this.getGenerator(),
      ...this.getCMakeArgs(),
    ];

    const command = `cmake ${args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')}`;

    this.logger.info(`[${this.target.name}] Configuring: ${command}`);

    await new Promise<void>((resolve, reject) => {
      const { spawn } = require('child_process');
      const proc = spawn('cmake', args, {
        cwd: this.projectRoot,
        stdio: 'inherit',
      });

      proc.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CMake configure failed with code ${code}`));
        }
      });

      proc.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  protected getExecutionCommand(): string {
    const args: string[] = ['--build', this.buildDirectory, '--target', this.target.targetName];

    // Add config for multi-config generators
    const generator = this.getGenerator();
    if (generator.includes('Visual Studio') || generator.includes('Xcode')) {
      args.push('--config', this.getBuildType());
    }

    // Add parallel build flag
    if (this.target.parallel !== false) {
      args.push('--parallel');
    }

    return `cmake ${args.join(' ')}`;
  }

  protected getBuilderName(): string {
    return `CMake/${this.getGenerator()}`;
  }

  public async validate(): Promise<void> {
    // Check if CMake is available
    try {
      const { execSync } = require('child_process');
      execSync('cmake --version', { stdio: 'ignore' });
    } catch {
      throw new Error('CMake is not installed or not in PATH');
    }

    // Check if CMakeLists.txt exists
    if (!existsSync(join(this.projectRoot, 'CMakeLists.txt'))) {
      throw new Error('No CMakeLists.txt found in project root');
    }

    // Validate target name
    if (!this.target.targetName) {
      throw new Error(`Target ${this.target.name}: targetName is required for CMake targets`);
    }
  }
}
