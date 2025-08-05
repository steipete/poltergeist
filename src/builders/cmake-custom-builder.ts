// CMake custom target builder
import type { CMakeCustomTarget } from '../types.js';
import { CMakeBuilder } from './cmake-builder.js';

export class CMakeCustomBuilder extends CMakeBuilder<CMakeCustomTarget> {
  protected async postBuild(): Promise<void> {
    // Custom targets don't necessarily produce output files
    this.logger.info(
      `[${this.target.name}] CMake custom target '${this.target.targetName}' completed`
    );
  }

  public getOutputInfo(): string | undefined {
    // Custom targets typically don't have a specific output file
    return undefined;
  }

  protected getBuilderName(): string {
    return `CMake-Custom/${this.getGenerator()}`;
  }
}
