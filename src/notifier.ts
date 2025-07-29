import notifier from 'node-notifier';
import type { BuildResult, BuildTarget } from './types.js';

export class BuildNotifier {
  constructor(
    private config: {
      enabled: boolean;
      successSound: string;
      failureSound: string;
      buildStart?: boolean;
      buildFailed?: boolean;
      buildSuccess?: boolean;
    }
  ) {}

  async notifyBuildStart(
    target: BuildTarget,
    projectName: string,
    targetName?: string
  ): Promise<void> {
    if (!this.config.enabled || 
        !this.config.buildStart || 
        process.env.POLTERGEIST_NOTIFICATIONS === 'false') {
      return;
    }

    const displayName = targetName || target;
    const title = `🔨 ${projectName} - ${displayName}`;
    const message = 'Build started...';

    notifier.notify({
      title,
      message,
      sound: false, // No sound for build start
      icon: '🔨',
      timeout: 2,
    });
  }

  async notifyBuildFailed(
    target: BuildTarget,
    projectName: string,
    error: string,
    targetName?: string
  ): Promise<void> {
    if (!this.config.enabled || 
        !this.config.buildFailed || 
        process.env.POLTERGEIST_NOTIFICATIONS === 'false') {
      return;
    }

    const displayName = targetName || target;
    const title = `❌ ${projectName} - ${displayName}`;
    const message = error.split('\n')[0] || 'Build failed';

    notifier.notify({
      title,
      message,
      sound: this.config.failureSound,
      icon: '❌',
      timeout: 10,
    });
  }

  async notifyBuildComplete(
    target: BuildTarget,
    result: BuildResult,
    projectName: string,
    targetName?: string
  ): Promise<void> {
    if (!this.config.enabled || 
        !this.config.buildSuccess || 
        process.env.POLTERGEIST_NOTIFICATIONS === 'false') {
      return;
    }

    const displayName = targetName || target;
    const title = result.success 
      ? `✅ ${projectName} - ${displayName}`
      : `❌ ${projectName} - ${displayName}`;

    const message = result.success
      ? `Build completed in ${(result.duration / 1000).toFixed(1)}s`
      : result.error?.split('\n')[0] || 'Build failed';

    notifier.notify({
      title,
      message,
      sound: result.success ? this.config.successSound : this.config.failureSound,
      icon: result.success ? '✅' : '❌',
      timeout: result.success ? 3 : 10,
    });
  }

  async notifyPoltergeistStarted(targets: string[]): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    notifier.notify({
      title: '👻 Poltergeist Started',
      message: `Watching ${targets.join(' and ')} for changes`,
      sound: false,
      timeout: 3,
    });
  }

  async notifyPoltergeistStopped(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    notifier.notify({
      title: '💤 Poltergeist Stopped',
      message: 'File watching has been stopped',
      sound: false,
      timeout: 3,
    });
  }
}