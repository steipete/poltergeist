// Simple file-based locking mechanism to prevent concurrent builds
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { hostname } from 'os';

export class Lock {
  private lockFile: string;
  private isLocked = false;

  constructor(lockFile: string) {
    this.lockFile = lockFile;
  }

  /**
   * Attempt to acquire the lock
   * Returns true if lock was acquired, false if already locked
   */
  public async acquire(): Promise<boolean> {
    if (this.isLocked) {
      return true; // We already have the lock
    }

    try {
      // Check if lock file exists
      if (existsSync(this.lockFile)) {
        // Read lock info to see if it's stale
        try {
          const lockInfo = JSON.parse(readFileSync(this.lockFile, 'utf-8'));
          const lockAge = Date.now() - lockInfo.timestamp;
          
          // If lock is older than 5 minutes, consider it stale
          if (lockAge > 5 * 60 * 1000) {
            this.forceRelease();
          } else {
            return false; // Lock is held by another process
          }
        } catch {
          // Corrupted lock file, remove it
          this.forceRelease();
        }
      }

      // Create lock file
      const lockInfo = {
        pid: process.pid,
        hostname: hostname(),
        timestamp: Date.now(),
      };

      writeFileSync(this.lockFile, JSON.stringify(lockInfo, null, 2), { flag: 'wx' });
      this.isLocked = true;

      // Ensure lock is released on process exit
      process.once('exit', () => this.release());
      process.once('SIGINT', () => this.release());
      process.once('SIGTERM', () => this.release());

      return true;
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        return false; // Another process created the lock file
      }
      throw error;
    }
  }

  /**
   * Release the lock
   */
  public async release(): Promise<void> {
    if (!this.isLocked) {
      return;
    }

    try {
      if (existsSync(this.lockFile)) {
        // Verify we own the lock before releasing
        try {
          const lockInfo = JSON.parse(readFileSync(this.lockFile, 'utf-8'));
          if (lockInfo.pid === process.pid) {
            unlinkSync(this.lockFile);
          }
        } catch {
          // If we can't read the lock file, just try to remove it
          unlinkSync(this.lockFile);
        }
      }
    } catch (error) {
      // Ignore errors during release
    } finally {
      this.isLocked = false;
    }
  }

  /**
   * Force release the lock (used for stale locks)
   */
  private forceRelease(): void {
    try {
      if (existsSync(this.lockFile)) {
        unlinkSync(this.lockFile);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Check if lock is currently held
   */
  public isAcquired(): boolean {
    return this.isLocked;
  }
}