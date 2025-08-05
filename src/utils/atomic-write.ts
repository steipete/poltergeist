//
//  atomic-write.ts
//  Poltergeist
//

import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface AtomicWriteOptions {
  encoding?: BufferEncoding;
  mode?: number;
  tmpfileCreated?: (tmpfile: string) => void;
}

/**
 * Atomically writes data to a file using the temp-file-and-rename strategy.
 * This ensures that the file is either fully written or not written at all,
 * preventing partial writes and corruption.
 *
 * @param filePath - The path to the file to write
 * @param data - The data to write (string or Buffer)
 * @param options - Optional write options
 */
export async function writeFileAtomic(
  filePath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const { encoding = 'utf8', mode, tmpfileCreated } = options;

  // Normalize the file path
  const normalizedPath = path.resolve(filePath);
  const dir = path.dirname(normalizedPath);
  const basename = path.basename(normalizedPath);

  // Ensure the directory exists
  await fs.mkdir(dir, { recursive: true });

  // Generate a unique temporary filename in the same directory
  // Using the same directory ensures atomic rename works across filesystems
  const randomBytes = crypto.randomBytes(8).toString('hex');
  const pid = process.pid;
  const tmpfile = path.join(dir, `.${basename}.${pid}.${randomBytes}.tmp`);

  // Notify about temp file creation if callback provided
  if (tmpfileCreated) {
    tmpfileCreated(tmpfile);
  }

  try {
    // Write data to the temporary file
    await fs.writeFile(tmpfile, data, { encoding, mode });

    // On Windows, we need to handle potential EBUSY errors during rename
    // Retry logic for Windows file system quirks
    let retries = 0;
    const maxRetries = 10;
    const retryDelay = 100; // ms

    while (retries < maxRetries) {
      try {
        // Atomically rename the temp file to the target file
        // This operation is atomic on POSIX systems and near-atomic on Windows
        await fs.rename(tmpfile, normalizedPath);
        break; // Success, exit the retry loop
      } catch (error: any) {
        if (error.code === 'EBUSY' || error.code === 'ENOTEMPTY' || error.code === 'EPERM') {
          // Windows-specific errors that might occur during rename
          retries++;
          if (retries >= maxRetries) {
            throw error; // Give up after max retries
          }
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        } else {
          throw error; // Other errors should be thrown immediately
        }
      }
    }
  } catch (error) {
    // Clean up the temp file if something went wrong
    try {
      await fs.unlink(tmpfile);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Synchronously writes data to a file atomically.
 * Not recommended for large files or performance-critical paths.
 */
export function writeFileAtomicSync(
  filePath: string,
  data: string | Buffer,
  options: Omit<AtomicWriteOptions, 'tmpfileCreated'> = {}
): void {
  const { encoding = 'utf8', mode } = options;
  const normalizedPath = path.resolve(filePath);
  const dir = path.dirname(normalizedPath);
  const basename = path.basename(normalizedPath);

  // Ensure directory exists
  const fsSync = require('node:fs');
  fsSync.mkdirSync(dir, { recursive: true });

  // Generate temp filename
  const randomBytes = crypto.randomBytes(8).toString('hex');
  const pid = process.pid;
  const tmpfile = path.join(dir, `.${basename}.${pid}.${randomBytes}.tmp`);

  try {
    // Write to temp file
    fsSync.writeFileSync(tmpfile, data, { encoding, mode });

    // Atomic rename with retry logic for Windows
    let retries = 0;
    const maxRetries = 10;

    while (retries < maxRetries) {
      try {
        fsSync.renameSync(tmpfile, normalizedPath);
        break;
      } catch (error: any) {
        if (error.code === 'EBUSY' || error.code === 'ENOTEMPTY' || error.code === 'EPERM') {
          retries++;
          if (retries >= maxRetries) {
            throw error;
          }
          // Brief synchronous delay
          const start = Date.now();
          while (Date.now() - start < 100) {
            // Busy wait
          }
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    // Cleanup on error
    try {
      fsSync.unlinkSync(tmpfile);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// Re-export with the same name as the original package for drop-in replacement
export default writeFileAtomic;
