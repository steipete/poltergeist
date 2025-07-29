import notifier from 'node-notifier';
import type { BuildResult, BuildTarget } from './types.js';

export class BuildNotifier {
  constructor(
    private enabled: boolean,
    private successSound: string,
    private failureSound: string
  ) {}

  async notifyBuildComplete(
    target: BuildTarget,
    result: BuildResult,
    projectName: string
  ): Promise<void> {
    if (!this.enabled || process.env.POLTERGEIST_NOTIFICATIONS === 'false') {
      return;
    }

    const targetName = target === 'cli' ? 'CLI' : 'Mac App';
    const title = result.success 
      ? `✅ ${projectName} ${targetName} Built`
      : `❌ ${projectName} ${targetName} Build Failed`;

    const message = result.success
      ? `Build completed in ${(result.duration / 1000).toFixed(1)}s`
      : result.error?.split('\n')[0] || 'Build failed';

    notifier.notify({
      title,
      message,
      sound: result.success ? this.successSound : this.failureSound,
      icon: result.success ? '✅' : '❌',
      timeout: result.success ? 3 : 10,
    });
  }

  async notifyPoltergeistStarted(targets: string[]): Promise<void> {
    if (!this.enabled) {
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
    if (!this.enabled) {
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