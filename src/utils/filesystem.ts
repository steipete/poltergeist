/**
 * Unified file system utilities for Poltergeist
 * Consolidates path operations, state file handling, and common file operations
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve as resolvePath, sep } from 'path';
import { DEFAULT_LOG_CHANNEL, sanitizeLogChannel } from './log-channels.js';

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
    const dir = process.env.POLTERGEIST_STATE_DIR || join(tmpdir(), 'poltergeist');
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        // Best-effort: if creation fails (permissions), fall back to returning the path.
      }
    }
    return dir;
  }

  /**
   * Generate unique state filename using project name + path hash + target
   * Format: {projectName}-{pathHash}-{targetName}.state
   * Path hash prevents collisions between projects with same name
   */
  public static generateStateFileName(projectRoot: string, targetName: string): string {
    // Use both Unix and Windows separators to handle cross-platform paths in tests
    const projectName = projectRoot.split(/[/\\]/).pop() || 'unknown';
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
   * Generate build log file name with project context
   * Uses same naming convention as state files for consistency
   */
  public static generateLogFileName(
    projectRoot: string,
    targetName: string,
    channel: string = DEFAULT_LOG_CHANNEL
  ): string {
    // Use both Unix and Windows separators to handle cross-platform paths in tests
    const projectName = projectRoot.split(/[/\\]/).pop() || 'unknown';
    const projectHash = createHash('sha256').update(projectRoot).digest('hex').substring(0, 8);
    const sanitizedChannel = sanitizeLogChannel(channel);
    const nameParts = [projectName, projectHash, targetName];
    // Only fan out log filenames when a non-default channel is requested to preserve existing paths.
    if (sanitizedChannel !== DEFAULT_LOG_CHANNEL) {
      nameParts.push(sanitizedChannel);
    }
    return `${nameParts.join('-')}.log`;
  }

  /**
   * Get full path to build log file for a target
   */
  public static getLogFilePath(
    projectRoot: string,
    targetName: string,
    channel: string = DEFAULT_LOG_CHANNEL
  ): string {
    const fileName = FileSystemUtils.generateLogFileName(projectRoot, targetName, channel);
    return join(FileSystemUtils.getStateDirectory(), fileName);
  }

  /**
   * Pause flag lives alongside state/log files so panel/daemon/CLI can flip it quickly.
   */
  public static getPauseFilePath(projectRoot: string): string {
    const fileName = `${projectRoot.split(/[/\\]/).pop() || 'project'}-${FileSystemUtils.projectHash(
      projectRoot
    )}.paused`;
    return join(FileSystemUtils.getStateDirectory(), fileName);
  }

  public static readPauseFlag(projectRoot: string): boolean {
    const pauseFile = FileSystemUtils.getPauseFilePath(projectRoot);
    return existsSync(pauseFile);
  }

  public static writePauseFlag(projectRoot: string, paused: boolean): void {
    const pauseFile = FileSystemUtils.getPauseFilePath(projectRoot);
    if (paused) {
      writeFileSync(pauseFile, 'paused', 'utf-8');
    } else {
      try {
        unlinkSync(pauseFile);
      } catch {
        // ignore if missing
      }
    }
  }

  private static projectHash(projectRoot: string): string {
    return createHash('sha256').update(projectRoot).digest('hex').substring(0, 6);
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
