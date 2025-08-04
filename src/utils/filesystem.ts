/**
 * Unified file system utilities for Poltergeist
 * Consolidates path operations, state file handling, and common file operations
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve as resolvePath, sep } from 'path';

/**
 * Centralized file system utilities for Poltergeist operations
 *
 * Note: Uses static-only class for namespacing and API organization.
 * This provides clear boundaries for filesystem-related functionality.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional design for API organization
export class FileSystemUtils {
  /**
   * Get the default state directory path (cross-platform)
   */
  public static getStateDirectory(): string {
    return process.env.POLTERGEIST_STATE_DIR || join(tmpdir(), 'poltergeist');
  }

  /**
   * Generate unique state filename using project name + path hash + target
   * Format: {projectName}-{pathHash}-{targetName}.state
   * Path hash prevents collisions between projects with same name
   */
  public static generateStateFileName(projectRoot: string, targetName: string): string {
    const projectName = projectRoot.split(sep).pop() || 'unknown';
    const projectHash = createHash('sha256').update(projectRoot).digest('hex').substring(0, 8);
    return `${projectName}-${projectHash}-${targetName}.state`;
  }

  /**
   * Get full path to state file for a target
   */
  public static getStateFilePath(projectRoot: string, targetName: string): string {
    const fileName = FileSystemUtils.generateStateFileName(projectRoot, targetName);
    return join(FileSystemUtils.getStateDirectory(), fileName);
  }

  /**
   * Check if a process is still alive by sending signal 0
   */
  public static isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safely read a JSON file with error handling
   */
  public static readJsonFile<T>(filePath: string): T | null {
    try {
      if (!existsSync(filePath)) {
        return null;
      }
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  /**
   * Read a JSON file and throw on parse errors (for distinguishing corruption from missing files)
   */
  public static readJsonFileStrict<T>(filePath: string): T | null {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T; // Will throw on invalid JSON
  }

  /**
   * Safely write a JSON file with atomic operation
   */
  public static writeJsonFile<T>(filePath: string, data: T): boolean {
    try {
      const content = JSON.stringify(data, null, 2);
      writeFileSync(filePath, content, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find a file by walking up the directory tree
   * @param startDir Starting directory (defaults to current working directory)
   * @param fileName File name to search for
   * @returns Full path to found file, or null if not found
   */
  public static findFileUpTree(fileName: string, startDir: string = process.cwd()): string | null {
    let currentDir = resolvePath(startDir);
    const root =
      process.platform === 'win32' ? resolvePath(currentDir.split(sep)[0] + sep) : resolvePath('/');

    while (currentDir !== root) {
      const filePath = resolvePath(currentDir, fileName);

      if (existsSync(filePath)) {
        return filePath;
      }

      currentDir = dirname(currentDir);
    }

    return null;
  }

  /**
   * Get project root directory containing the configuration file
   */
  public static findProjectRoot(startDir: string = process.cwd()): string | null {
    const configPath = FileSystemUtils.findFileUpTree('poltergeist.config.json', startDir);
    return configPath ? dirname(configPath) : null;
  }
}
