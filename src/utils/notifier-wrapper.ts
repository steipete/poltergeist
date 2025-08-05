//
//  notifier-wrapper.ts
//  Poltergeist
//

/**
 * ESM wrapper for node-notifier CommonJS module.
 * Uses dynamic import to load the CommonJS module lazily,
 * allowing Bun bytecode compilation to proceed.
 */

export interface NotificationOptions {
  title: string;
  message: string;
  sound?: string | boolean;
  timeout?: number;
  icon?: string;
  appIcon?: string;
}

class NotifierWrapper {
  private notifierModule: any = null;
  private loadAttempted = false;

  /**
   * Lazily loads the node-notifier module.
   * Falls back gracefully if the module is not available.
   */
  private async loadNotifier(): Promise<any> {
    if (this.loadAttempted) {
      return this.notifierModule;
    }

    this.loadAttempted = true;

    try {
      // Dynamic import of CommonJS module
      // This allows Bun to compile without the dependency
      const module = await import('node-notifier');
      this.notifierModule = module.default || module;
      return this.notifierModule;
    } catch (error) {
      console.debug('node-notifier not available, notifications disabled:', error);
      return null;
    }
  }

  /**
   * Send a notification using node-notifier if available.
   * Silently fails if node-notifier is not installed or cannot be loaded.
   */
  async notify(options: NotificationOptions): Promise<void> {
    const notifier = await this.loadNotifier();

    if (!notifier) {
      // Silently skip notification if module not available
      return;
    }

    try {
      // Map our options to node-notifier format
      const notifierOptions: any = {
        title: options.title,
        message: options.message,
        timeout: options.timeout,
      };

      // Handle sound option
      if (options.sound !== undefined) {
        notifierOptions.sound = options.sound;
      }

      // Handle icon options
      if (options.appIcon) {
        notifierOptions.appIcon = options.appIcon;
      } else if (options.icon) {
        notifierOptions.icon = options.icon;
      }

      // Call node-notifier's notify method
      notifier.notify(notifierOptions);
    } catch (error) {
      // Silently fail - notifications are non-critical
      console.debug('Notification failed:', error);
    }
  }

  /**
   * Check if notifications are available.
   * Useful for debugging or conditional features.
   */
  async isAvailable(): Promise<boolean> {
    const notifier = await this.loadNotifier();
    return notifier !== null;
  }
}

// Create singleton instance
const notifier = new NotifierWrapper();

// Export both named and default exports for compatibility
export { notifier };
export default notifier;
