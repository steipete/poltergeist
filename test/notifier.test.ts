// Comprehensive tests for BuildNotifier

import notifier from 'node-notifier';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildNotifier } from '../src/notifier.js';

// Mock node-notifier
vi.mock('node-notifier', () => ({
  default: {
    notify: vi.fn(),
  },
}));

describe('BuildNotifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear environment variable
    delete process.env.POLTERGEIST_NOTIFICATIONS;
  });

  afterEach(() => {
    // Clean up environment
    delete process.env.POLTERGEIST_NOTIFICATIONS;
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      const config = {
        enabled: true,
        successSound: 'Ping',
        failureSound: 'Basso',
        buildStart: true,
        buildFailed: true,
        buildSuccess: true,
      };

      const buildNotifier = new BuildNotifier(config);
      expect(buildNotifier).toBeInstanceOf(BuildNotifier);
    });
  });

  describe('notifyBuildStart', () => {
    it('should send notification when enabled', async () => {
      const config = {
        enabled: true,
        buildStart: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildStart('cli', 'MyProject', 'CLI Target');

      expect(notifier.notify).toHaveBeenCalledWith({
        title: '🔨 MyProject - CLI Target',
        message: 'Build started...',
        sound: false,
        icon: '🔨',
        timeout: 2,
      });
    });

    it('should use target as display name when targetName not provided', async () => {
      const config = {
        enabled: true,
        buildStart: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildStart('cli', 'MyProject');

      expect(notifier.notify).toHaveBeenCalledWith({
        title: '🔨 MyProject - cli',
        message: 'Build started...',
        sound: false,
        icon: '🔨',
        timeout: 2,
      });
    });

    it('should not send notification when disabled', async () => {
      const config = {
        enabled: false,
        buildStart: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildStart('cli', 'MyProject');

      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('should not send notification when buildStart is false', async () => {
      const config = {
        enabled: true,
        buildStart: false,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildStart('cli', 'MyProject');

      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('should respect POLTERGEIST_NOTIFICATIONS environment variable', async () => {
      process.env.POLTERGEIST_NOTIFICATIONS = 'false';

      const config = {
        enabled: true,
        buildStart: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildStart('cli', 'MyProject');

      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('notifyBuildFailed', () => {
    it('should send notification with failure sound', async () => {
      const config = {
        enabled: true,
        buildFailed: true,
        failureSound: 'Sosumi',
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildFailed('Build Failed', 'Error in compilation');

      expect(notifier.notify).toHaveBeenCalledWith({
        title: 'Build Failed',
        message: 'Error in compilation',
        sound: 'Sosumi',
        timeout: 10,
        icon: '❌',
      });
    });

    it('should use default failure sound when not specified', async () => {
      const config = {
        enabled: true,
        buildFailed: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildFailed('Build Failed', 'Error in compilation');

      expect(notifier.notify).toHaveBeenCalledWith({
        title: 'Build Failed',
        message: 'Error in compilation',
        sound: 'Basso',
        timeout: 10,
        icon: '❌',
      });
    });

    it('should use custom icon when provided', async () => {
      const config = {
        enabled: true,
        buildFailed: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildFailed(
        'Build Failed',
        'Error in compilation',
        '/path/to/icon.png'
      );

      expect(notifier.notify).toHaveBeenCalledWith({
        title: 'Build Failed',
        message: 'Error in compilation',
        sound: 'Basso',
        timeout: 10,
        appIcon: '/path/to/icon.png',
      });
    });

    it('should not send notification when disabled', async () => {
      const config = {
        enabled: false,
        buildFailed: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildFailed('Build Failed', 'Error');

      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('should not send notification when buildFailed is false', async () => {
      const config = {
        enabled: true,
        buildFailed: false,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildFailed('Build Failed', 'Error');

      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('should respect POLTERGEIST_NOTIFICATIONS environment variable', async () => {
      process.env.POLTERGEIST_NOTIFICATIONS = 'false';

      const config = {
        enabled: true,
        buildFailed: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildFailed('Build Failed', 'Error');

      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('notifyBuildComplete', () => {
    it('should send notification with success sound', async () => {
      const config = {
        enabled: true,
        buildSuccess: true,
        successSound: 'Hero',
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildComplete('Build Succeeded', 'Build completed in 2.5s');

      expect(notifier.notify).toHaveBeenCalledWith({
        title: 'Build Succeeded',
        message: 'Build completed in 2.5s',
        sound: 'Hero',
        timeout: 3,
        icon: '✅',
      });
    });

    it('should use default success sound when not specified', async () => {
      const config = {
        enabled: true,
        buildSuccess: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildComplete('Build Succeeded', 'All tests passed');

      expect(notifier.notify).toHaveBeenCalledWith({
        title: 'Build Succeeded',
        message: 'All tests passed',
        sound: 'Glass',
        timeout: 3,
        icon: '✅',
      });
    });

    it('should use custom icon when provided', async () => {
      const config = {
        enabled: true,
        buildSuccess: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildComplete('Build Succeeded', 'Done', '/path/to/success.png');

      expect(notifier.notify).toHaveBeenCalledWith({
        title: 'Build Succeeded',
        message: 'Done',
        sound: 'Glass',
        timeout: 3,
        appIcon: '/path/to/success.png',
      });
    });

    it('should not send notification when disabled', async () => {
      const config = {
        enabled: false,
        buildSuccess: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildComplete('Build Succeeded', 'Done');

      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('should not send notification when buildSuccess is false', async () => {
      const config = {
        enabled: true,
        buildSuccess: false,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildComplete('Build Succeeded', 'Done');

      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('should respect POLTERGEIST_NOTIFICATIONS environment variable', async () => {
      process.env.POLTERGEIST_NOTIFICATIONS = 'false';

      const config = {
        enabled: true,
        buildSuccess: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyBuildComplete('Build Succeeded', 'Done');

      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('notifyPoltergeistStarted', () => {
    it('should send notification with multiple targets', async () => {
      const config = {
        enabled: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyPoltergeistStarted(['cli', 'app', 'test']);

      expect(notifier.notify).toHaveBeenCalledWith({
        title: '👻 Poltergeist Started',
        message: 'Watching cli and app and test for changes',
        sound: false,
        timeout: 3,
      });
    });

    it('should send notification with single target', async () => {
      const config = {
        enabled: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyPoltergeistStarted(['cli']);

      expect(notifier.notify).toHaveBeenCalledWith({
        title: '👻 Poltergeist Started',
        message: 'Watching cli for changes',
        sound: false,
        timeout: 3,
      });
    });

    it('should not send notification when disabled', async () => {
      const config = {
        enabled: false,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyPoltergeistStarted(['cli']);

      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('should work with empty targets array', async () => {
      const config = {
        enabled: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyPoltergeistStarted([]);

      expect(notifier.notify).toHaveBeenCalledWith({
        title: '👻 Poltergeist Started',
        message: 'Watching  for changes',
        sound: false,
        timeout: 3,
      });
    });
  });

  describe('notifyPoltergeistStopped', () => {
    it('should send notification when enabled', async () => {
      const config = {
        enabled: true,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyPoltergeistStopped();

      expect(notifier.notify).toHaveBeenCalledWith({
        title: '💤 Poltergeist Stopped',
        message: 'File watching has been stopped',
        sound: false,
        timeout: 3,
      });
    });

    it('should not send notification when disabled', async () => {
      const config = {
        enabled: false,
      };

      const buildNotifier = new BuildNotifier(config);
      await buildNotifier.notifyPoltergeistStopped();

      expect(notifier.notify).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimal config', async () => {
      const config = {
        enabled: true,
      };

      const buildNotifier = new BuildNotifier(config);

      // Should not send any build notifications without specific flags
      await buildNotifier.notifyBuildStart('cli', 'Project');
      await buildNotifier.notifyBuildFailed('Failed', 'Error');
      await buildNotifier.notifyBuildComplete('Success', 'Done');

      expect(notifier.notify).not.toHaveBeenCalled();
    });

    it('should handle all notifications enabled', async () => {
      const config = {
        enabled: true,
        buildStart: true,
        buildFailed: true,
        buildSuccess: true,
      };

      const buildNotifier = new BuildNotifier(config);

      await buildNotifier.notifyBuildStart('cli', 'Project');
      await buildNotifier.notifyBuildFailed('Failed', 'Error');
      await buildNotifier.notifyBuildComplete('Success', 'Done');

      expect(notifier.notify).toHaveBeenCalledTimes(3);
    });

    it('should handle long project and target names', async () => {
      const config = {
        enabled: true,
        buildStart: true,
      };

      const buildNotifier = new BuildNotifier(config);
      const longProjectName = 'A'.repeat(100);
      const longTargetName = 'B'.repeat(100);

      await buildNotifier.notifyBuildStart('cli', longProjectName, longTargetName);

      expect(notifier.notify).toHaveBeenCalledWith({
        title: `🔨 ${longProjectName} - ${longTargetName}`,
        message: 'Build started...',
        sound: false,
        icon: '🔨',
        timeout: 2,
      });
    });
  });
});
