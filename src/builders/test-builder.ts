import { BaseBuilder } from './base-builder.js';
import type { TestTarget } from '../types.js';

export class TestBuilder extends BaseBuilder<TestTarget> {
  protected getBuilderName(): string {
    return 'test';
  }

  protected getExecutionCommand(): string {
    if (!this.target.testCommand) {
      throw new Error(`No testCommand defined for target: ${this.target.name}`);
    }
    return this.target.testCommand;
  }

  public getOutputInfo(): string | undefined {
    return undefined;
  }

  public async validate(): Promise<void> {
    if (!this.target.testCommand) {
      throw new Error(`Missing testCommand for target: ${this.target.name}`);
    }
  }
}
