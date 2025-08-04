// Windows-safe file system operations for tests

import { rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { platform } from 'os';

const isWindows = platform() === 'win32';

/**
 * Removes a directory with retry logic for Windows
 */
export async function safeRemoveDir(path: string, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (existsSync(path)) {
        await rm(path, { recursive: true, force: true, maxRetries: isWindows ? 10 : 3 });
      }
      return;
    } catch (error: any) {
      if (attempt === maxRetries) {
        // On final attempt, ignore errors if directory doesn't exist
        if (error.code === 'ENOENT') {
          return;
        }
        throw error;
      }
      
      // On Windows, wait a bit before retrying
      if (isWindows && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
      }
    }
  }
}

/**
 * Creates a directory with retry logic for Windows
 */
export async function safeCreateDir(path: string, maxRetries = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await mkdir(path, { recursive: true });
      return;
    } catch (error: any) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // If directory already exists, that's fine
      if (error.code === 'EEXIST') {
        return;
      }
      
      // On Windows, wait a bit before retrying
      if (isWindows) {
        await new Promise(resolve => setTimeout(resolve, 50 * attempt));
      }
    }
  }
}

/**
 * Adds a small delay on Windows to allow file handles to be released
 */
export async function windowsDelay(ms = 50): Promise<void> {
  if (isWindows) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}