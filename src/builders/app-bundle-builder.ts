// Builder for app bundle targets (macOS, iOS apps)
import { spawn } from 'child_process';
import { BaseBuilder } from './base-builder.js';
import { AppBundleTarget } from '../types.js';

export class AppBundleBuilder extends BaseBuilder<AppBundleTarget> {
  private isAppRunning = false;
  private lastLaunchTime = 0;
  private readonly MIN_RELAUNCH_INTERVAL = 1000; // 1 second

  public async validate(): Promise<void> {
    if (!this.target.bundleId) {
      throw new Error(`Target ${this.target.name}: bundleId is required for app-bundle targets`);
    }

    if (!this.target.buildCommand) {
      throw new Error(`Target ${this.target.name}: buildCommand is required`);
    }
  }

  protected async postBuild(): Promise<void> {
    if (this.target.autoRelaunch) {
      await this.relaunchApp();
    }
  }

  private async relaunchApp(): Promise<void> {
    const now = Date.now();
    if (now - this.lastLaunchTime < this.MIN_RELAUNCH_INTERVAL) {
      this.logger.info(`[${this.target.name}] Skipping relaunch (too soon after last launch)`);
      return;
    }

    try {
      // First, try to quit the app gracefully
      if (this.isAppRunning) {
        await this.quitApp();
        // Wait a bit for the app to quit
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Launch the app
      await this.launchApp();
      this.lastLaunchTime = now;
      this.isAppRunning = true;
    } catch (error) {
      this.logger.error(`[${this.target.name}] Failed to relaunch app: ${error}`);
    }
  }

  private async quitApp(): Promise<void> {
    return new Promise((resolve) => {
      const platform = this.target.platform || 'macos';
      
      if (platform === 'macos') {
        // Use osascript to quit the app gracefully
        const quitProcess = spawn('osascript', [
          '-e',
          `tell application id "${this.target.bundleId}" to quit`
        ]);

        quitProcess.on('close', () => {
          this.logger.info(`[${this.target.name}] App quit successfully`);
          resolve();
        });

        quitProcess.on('error', (error) => {
          this.logger.warn(`[${this.target.name}] Failed to quit app: ${error}`);
          resolve(); // Continue anyway
        });
      } else {
        // For iOS/tvOS/etc, we might use different commands
        this.logger.warn(`[${this.target.name}] App quit not implemented for platform: ${platform}`);
        resolve();
      }
    });
  }

  private async launchApp(): Promise<void> {
    return new Promise((resolve, reject) => {
      const platform = this.target.platform || 'macos';
      
      if (this.target.launchCommand) {
        // Use custom launch command
        const launchProcess = spawn(this.target.launchCommand, {
          shell: true,
          detached: true,
          stdio: 'ignore'
        });

        launchProcess.unref();
        this.logger.info(`[${this.target.name}] App launched with custom command`);
        resolve();
      } else if (platform === 'macos') {
        // Use open command for macOS
        const launchProcess = spawn('open', [
          '-b',
          this.target.bundleId
        ], {
          detached: true,
          stdio: 'ignore'
        });

        launchProcess.unref();
        
        launchProcess.on('error', (error) => {
          reject(new Error(`Failed to launch app: ${error.message}`));
        });

        // Give it a moment to start
        setTimeout(() => {
          this.logger.info(`[${this.target.name}] App launched: ${this.target.bundleId}`);
          resolve();
        }, 100);
      } else {
        this.logger.warn(`[${this.target.name}] App launch not implemented for platform: ${platform}`);
        resolve();
      }
    });
  }

  public getOutputInfo(): string {
    return `${this.target.bundleId} (${this.target.platform || 'macos'})`;
  }

  public stop(): void {
    super.stop();
    this.isAppRunning = false;
  }
}