//
//  native-notifier.ts
//  Poltergeist
//

import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface Notification {
  title: string;
  message: string;
  sound?: string | boolean;
  timeout?: number;
  icon?: string;
  appIcon?: string;
}

export interface NotificationOptions extends Notification {
  sound?: string | boolean;
  timeout?: number;
  appIcon?: string;
}

class NativeNotifier {
  private platform: string;

  constructor() {
    this.platform = platform();
  }

  async notify(options: NotificationOptions): Promise<void> {
    const { title, message, sound, timeout, icon, appIcon } = options;

    try {
      switch (this.platform) {
        case 'darwin':
          await this.notifyMacOS(title, message, sound, appIcon || icon);
          break;
        case 'linux':
          await this.notifyLinux(title, message, timeout, appIcon || icon);
          break;
        case 'win32':
          await this.notifyWindows(title, message, appIcon || icon);
          break;
        default:
          // Silently ignore on unsupported platforms
          break;
      }
    } catch (error) {
      // Silently fail - notifications are non-critical
      console.debug('Notification failed:', error);
    }
  }

  private async notifyMacOS(
    title: string,
    message: string,
    sound?: string | boolean,
    _icon?: string
  ): Promise<void> {
    // Use osascript to display notifications on macOS
    let script = `display notification "${this.escapeString(message)}" with title "${this.escapeString(title)}"`;

    if (sound) {
      const soundName = typeof sound === 'string' ? sound : 'default';
      script += ` sound name "${soundName}"`;
    }

    const command = `osascript -e '${script}'`;
    await execAsync(command);
  }

  private async notifyLinux(
    title: string,
    message: string,
    timeout?: number,
    icon?: string
  ): Promise<void> {
    // Use notify-send on Linux (requires libnotify-bin)
    let command = `notify-send "${this.escapeShell(title)}" "${this.escapeShell(message)}"`;

    if (timeout) {
      command += ` -t ${timeout * 1000}`; // Convert to milliseconds
    }

    if (icon && !icon.includes('🔨') && !icon.includes('❌') && !icon.includes('✅')) {
      // Only use icon parameter for file paths, not emojis
      command += ` -i "${this.escapeShell(icon)}"`;
    }

    try {
      await execAsync(command);
    } catch (error: any) {
      if (error.code === 127) {
        // notify-send not installed, silently ignore
        console.debug('notify-send not found, notifications disabled on Linux');
      }
    }
  }

  private async notifyWindows(title: string, message: string, _icon?: string): Promise<void> {
    // Use PowerShell for Windows 10+ toast notifications
    const escapedTitle = this.escapePowerShell(title);
    const escapedMessage = this.escapePowerShell(message);

    const script = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

      $APP_ID = 'Poltergeist'
      
      $template = @"
      <toast>
        <visual>
          <binding template="ToastText02">
            <text id="1">${escapedTitle}</text>
            <text id="2">${escapedMessage}</text>
          </binding>
        </visual>
      </toast>
"@

      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($APP_ID).Show($toast)
    `;

    const command = `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${script.replace(/\n/g, ' ')}"`;

    try {
      await execAsync(command, {
        windowsHide: true,
        timeout: 5000,
      });
    } catch (_error: any) {
      // Fall back to msg command for older Windows
      const fallbackCommand = `msg * /TIME:${5} "${this.escapeShell(title)}: ${this.escapeShell(message)}"`;
      try {
        await execAsync(fallbackCommand, { windowsHide: true });
      } catch {
        // Silently fail if both methods don't work
      }
    }
  }

  private escapeString(str: string): string {
    // Escape for AppleScript
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private escapeShell(str: string): string {
    // Escape for shell commands
    return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
  }

  private escapePowerShell(str: string): string {
    // Escape for PowerShell
    return str.replace(/"/g, '`"').replace(/\$/g, '`$');
  }
}

// Create singleton instance
const notifier = new NativeNotifier();

// Export both named and default exports for compatibility
export { notifier };
export default notifier;
