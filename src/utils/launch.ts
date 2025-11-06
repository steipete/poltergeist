import { existsSync } from 'fs';
import { resolve as resolvePath } from 'path';
import type { Target } from '../types.js';

export type LaunchErrorCode = 'NO_OUTPUT_PATH' | 'BINARY_NOT_FOUND';

export interface LaunchInfo {
  command: string;
  commandArgs: string[];
  binaryPath: string;
}

export class LaunchPreparationError extends Error {
  public readonly code: LaunchErrorCode;
  public readonly targetName: string;
  public readonly binaryPath?: string;

  constructor(code: LaunchErrorCode, targetName: string, binaryPath?: string) {
    const message =
      code === 'NO_OUTPUT_PATH'
        ? `Target '${targetName}' does not have an output path`
        : `Binary not found: ${binaryPath ?? '<unknown>'}`;
    super(message);
    this.code = code;
    this.targetName = targetName;
    this.binaryPath = binaryPath;
  }
}

export function prepareLaunchInfo(target: Target, projectRoot: string, args: string[]): LaunchInfo {
  if (!('outputPath' in target) || !target.outputPath) {
    throw new LaunchPreparationError('NO_OUTPUT_PATH', target.name);
  }

  const binaryPath = resolvePath(projectRoot, target.outputPath);
  if (!existsSync(binaryPath)) {
    throw new LaunchPreparationError('BINARY_NOT_FOUND', target.name, binaryPath);
  }

  const ext = binaryPath.toLowerCase();
  let command: string;
  let commandArgs: string[];

  if (ext.endsWith('.js') || ext.endsWith('.mjs')) {
    command = 'node';
    commandArgs = [binaryPath, ...args];
  } else if (ext.endsWith('.py')) {
    command = 'python';
    commandArgs = [binaryPath, ...args];
  } else if (ext.endsWith('.sh')) {
    command = 'sh';
    commandArgs = [binaryPath, ...args];
  } else {
    command = binaryPath;
    commandArgs = args;
  }

  return {
    command,
    commandArgs,
    binaryPath,
  };
}
