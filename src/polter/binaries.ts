import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { resolve as resolvePath } from 'path';

import type { PoltergeistState } from '../state.js';
import { BuildStatusManager } from '../utils/build-status-manager.js';
import { FileSystemUtils } from '../utils/filesystem.js';
import { getStateFile } from './build-status.js';

export function resolveBinaryPath(targetName: string, projectRoot: string): string | null {
  const possiblePaths = [
    resolvePath(projectRoot, `./dist/${targetName}`),
    resolvePath(projectRoot, `./dist/${targetName}.js`),
    resolvePath(projectRoot, `./build/${targetName}`),
    resolvePath(projectRoot, `./build/${targetName}.js`),
    resolvePath(projectRoot, targetName),
    resolvePath(projectRoot, `./${targetName}`),
    resolvePath(projectRoot, `./${targetName}.js`),
    resolvePath(projectRoot, `./${targetName.replace('-cli', '')}`),
    resolvePath(projectRoot, `./${targetName.replace('-cli', '')}.js`),
    resolvePath(projectRoot, `./${targetName.replace('-app', '')}`),
    resolvePath(projectRoot, `./${targetName.replace('-app', '')}.js`),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

export async function isBinaryFresh(
  projectRoot: string,
  targetName: string,
  binaryPath: string | null
): Promise<boolean> {
  if (!binaryPath) {
    return false;
  }

  const statePath = getStateFile(projectRoot, targetName);
  if (!statePath || !existsSync(statePath)) {
    return false;
  }

  try {
    const state = FileSystemUtils.readJsonFileStrict<PoltergeistState>(statePath);
    if (!state?.lastBuild || !BuildStatusManager.isSuccess(state.lastBuild)) {
      return false;
    }

    const buildTime = new Date(state.lastBuild.timestamp).getTime();
    const binMTime = statSync(binaryPath).mtimeMs;
    if (Number.isNaN(buildTime) || binMTime + 1 < buildTime) {
      return false;
    }

    try {
      const head = execSync('git rev-parse HEAD', { cwd: projectRoot, stdio: 'pipe' })
        .toString()
        .trim();
      if (state.lastBuild.gitHash && head && head !== state.lastBuild.gitHash) {
        return false;
      }

      const status = execSync('git status --porcelain', { cwd: projectRoot, stdio: 'pipe' })
        .toString()
        .trim();
      if (status.length > 0) {
        return false;
      }
    } catch {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
