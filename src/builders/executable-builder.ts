// Builder for executable targets (CLI tools, binaries)
import { existsSync } from 'fs';
import { BaseBuilder } from './base-builder.js';
import { ExecutableTarget } from '../types.js';

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
    // Check if the output binary was created
    if (!existsSync(this.target.outputPath)) {
      throw new Error(`Expected output file not found: ${this.target.outputPath}`);
    }

    this.logger.info(`[${this.target.name}] Executable built: ${this.target.outputPath}`);
  }

  public getOutputInfo(): string {
    return this.target.outputPath;
  }
}