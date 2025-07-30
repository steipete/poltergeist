// Builder for executable targets (CLI tools, binaries)
import { existsSync } from 'fs';
import { join } from 'path';
import type { ExecutableTarget } from '../types.js';
import { BaseBuilder } from './base-builder.js';

export class ExecutableBuilder extends BaseBuilder<ExecutableTarget> {
  public async validate(): Promise<void> {
    // Validate that build command exists
    if (!this.target.buildCommand) {
      throw new Error(`Target ${this.target.name}: buildCommand is required`);
    }

    // Validate output path is specified
    if (!this.target.outputPath) {
      throw new Error(`Target ${this.target.name}: outputPath is required for executable targets`);
    }
  }

  protected async postBuild(): Promise<void> {
    // Resolve output path relative to project root
    const outputPath = join(this.projectRoot, this.target.outputPath);

    // Check if the output binary was created
    if (!existsSync(outputPath)) {
      throw new Error(`Expected output file not found: ${outputPath}`);
    }

    this.logger.info(`[${this.target.name}] Executable built: ${outputPath}`);

    // Update state with output info (store relative path, not absolute)
    await this.stateManager.updateAppInfo(this.target.name, {
      outputPath: this.target.outputPath,
    });
  }

  protected getBuilderName(): string {
    return 'Executable';
  }

  public getOutputInfo(): string {
    return this.target.outputPath;
  }
}
