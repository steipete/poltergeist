import notifier from 'node-notifier';

interface ExtendedNotification extends notifier.Notification {
  sound?: string | boolean;
  timeout?: number;
  appIcon?: string;
}

export class BuildNotifier {
  constructor(
    private config: {
      enabled: boolean;
      successSound?: string;
      failureSound?: string;
      buildStart?: boolean;
      buildFailed?: boolean;
      buildSuccess?: boolean;
    }
  ) {}

  async notifyBuildStart(target: string, projectName: string, targetName?: string): Promise<void> {
    if (
      !this.config.enabled ||
      !this.config.buildStart ||
      process.env.POLTERGEIST_NOTIFICATIONS === 'false'
    ) {
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

  async notifyBuildFailed(title: string, message: string, iconPath?: string): Promise<void> {
    if (
      !this.config.enabled ||
      !this.config.buildFailed ||
      process.env.POLTERGEIST_NOTIFICATIONS === 'false'
    ) {
      return;
    }

    // title and message are already provided as parameters

    const notificationOptions: ExtendedNotification = {
      title,
      message,
      sound: this.config.failureSound || 'Basso',
      timeout: 10,
    };

    // Use custom icon if provided, otherwise fallback to emoji
    if (iconPath) {
      notificationOptions.appIcon = iconPath;
    } else {
      notificationOptions.icon = '❌';
    }

    notifier.notify(notificationOptions);
  }

  async notifyBuildComplete(title: string, message: string, iconPath?: string): Promise<void> {
    if (
      !this.config.enabled ||
      !this.config.buildSuccess ||
      process.env.POLTERGEIST_NOTIFICATIONS === 'false'
    ) {
      return;
    }

    // title and message are already provided as parameters

    const notificationOptions: ExtendedNotification = {
      title,
      message,
      sound: this.config.successSound || 'Glass',
      timeout: 3,
    };

    // Use custom icon if provided, otherwise fallback to emoji
    if (iconPath) {
      notificationOptions.appIcon = iconPath;
    } else {
      notificationOptions.icon = '✅';
    }

    notifier.notify(notificationOptions);
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
