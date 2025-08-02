// Tests for Watchman integration

import watchman from 'fb-watchman';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/logger.js';
import { WatchmanClient } from '../src/watchman.js';

// Mock watchman
vi.mock('fb-watchman', () => ({
  default: {
    Client: vi.fn(),
  },
}));

describe('WatchmanClient', () => {
  let client: WatchmanClient;
  let mockLogger: Logger;
  let mockWatchmanInstance: {
    capabilityCheck: ReturnType<typeof vi.fn>;
    command: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      success: vi.fn(),
    };

    // Mock watchman client instance
    mockWatchmanInstance = {
      on: vi.fn(),
      command: vi.fn(),
      end: vi.fn(),
      removeListener: vi.fn(),
      capabilityCheck: vi.fn((_caps, callback) => {
        callback(null);
      }),
    };

    vi.mocked(watchman.Client).mockImplementation(() => mockWatchmanInstance);

    client = new WatchmanClient(mockLogger);
  });

  describe('Connection', () => {
    it('should connect to watchman successfully', async () => {
      await client.connect();

      expect(mockWatchmanInstance.capabilityCheck).toHaveBeenCalledWith(
        { optional: [], required: ['relative_root'] },
        expect.any(Function)
      );
      expect(mockLogger.info).toHaveBeenCalledWith('Connected to Watchman');
    });

    it('should handle connection errors', async () => {
      mockWatchmanInstance.capabilityCheck.mockImplementation((_caps, callback) => {
        callback(new Error('Connection failed'));
      });

      await expect(client.connect()).rejects.toThrow(
        'Watchman capability check failed: Connection failed'
      );
    });

    it('should set up error and end event handlers', () => {
      expect(mockWatchmanInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockWatchmanInstance.on).toHaveBeenCalledWith('end', expect.any(Function));
    });
  });

  describe('Watch Operations', () => {
    beforeEach(async () => {
      await client.connect();
      vi.clearAllMocks();
    });

    it('should watch a project successfully', async () => {
      const projectPath = '/test/project';

      mockWatchmanInstance.command.mockImplementation((args, callback) => {
        if (args[0] === 'watch-project') {
          callback(null, {
            watch: projectPath,
            relative_path: null,
          });
        }
      });

      await client.watchProject(projectPath);

      expect(mockWatchmanInstance.command).toHaveBeenCalledWith(
        ['watch-project', projectPath],
        expect.any(Function)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(`Watching project at: ${projectPath}`);
    });

    it('should handle watch errors', async () => {
      const projectPath = '/non/existent/path';

      mockWatchmanInstance.command.mockImplementation((args, callback) => {
        if (args[0] === 'watch-project') {
          callback(new Error('unable to resolve root'), null);
        }
      });

      await expect(client.watchProject(projectPath)).rejects.toThrow(
        'Failed to watch project: unable to resolve root'
      );
    });
  });

  describe('Subscriptions', () => {
    beforeEach(async () => {
      mockWatchmanInstance.command.mockImplementation((args, callback) => {
        if (args[0] === 'watch-project') {
          callback(null, { watch: '/test/project' });
        } else if (args[0] === 'subscribe') {
          callback(null, {});
        }
      });

      await client.connect();
      await client.watchProject('/test/project');
      vi.clearAllMocks();
    });

    it('should create subscriptions with enhanced expressions', async () => {
      const callback = vi.fn();

      await client.subscribe(
        '/test/project',
        'test-subscription',
        {
          expression: ['match', '**/*.js', 'wholename'],
          fields: ['name', 'exists', 'type'],
        },
        callback,
        [
          ['not', ['match', '**/.build/**', 'wholename']],
          ['not', ['match', '**/DerivedData/**', 'wholename']],
          ['not', ['match', '**/node_modules/**', 'wholename']],
          ['not', ['match', '**/.git/**', 'wholename']],
        ]
      );

      expect(mockWatchmanInstance.command).toHaveBeenCalledWith(
        expect.arrayContaining([
          'subscribe',
          '/test/project',
          'test-subscription',
          expect.objectContaining({
            expression: expect.arrayContaining([
              'allof',
              ['match', '**/*.js', 'wholename'],
              ['not', ['match', '**/.build/**', 'wholename']],
              ['not', ['match', '**/DerivedData/**', 'wholename']],
              ['not', ['match', '**/node_modules/**', 'wholename']],
              ['not', ['match', '**/.git/**', 'wholename']],
            ]),
            fields: ['name', 'exists', 'type'],
          }),
        ]),
        expect.any(Function)
      );
    });

    it('should handle subscription errors', async () => {
      mockWatchmanInstance.command.mockImplementation((args, callback) => {
        if (args[0] === 'subscribe') {
          callback(new Error('Subscription failed'), null);
        }
      });

      await expect(
        client.subscribe(
          '/test/project',
          'test-subscription',
          {
            expression: ['match', '**/*.js', 'wholename'],
            fields: ['name', 'exists'],
          },
          vi.fn()
        )
      ).rejects.toThrow('Failed to create subscription: Subscription failed');
    });

    it('should handle file change events', async () => {
      const callback = vi.fn();
      let subscriptionHandler:
        | ((resp: {
            subscription: string;
            files: Array<{ name: string; exists: boolean; new: boolean }>;
          }) => void)
        | undefined;

      // Capture the subscription handler
      mockWatchmanInstance.on.mockImplementation((event, handler) => {
        if (event === 'subscription') {
          subscriptionHandler = handler;
        }
      });

      await client.subscribe(
        '/test/project',
        'test-subscription',
        {
          expression: ['match', '**/*.js', 'wholename'],
          fields: ['name', 'exists', 'type'],
        },
        callback
      );

      // Simulate file change event
      subscriptionHandler({
        subscription: 'test-subscription',
        files: [
          { name: 'src/index.js', exists: true, new: true },
          { name: 'src/utils.js', exists: true, new: false },
        ],
      });

      expect(callback).toHaveBeenCalledWith([
        { name: 'src/index.js', exists: true, type: 'new' },
        { name: 'src/utils.js', exists: true, type: undefined },
      ]);
    });
  });

  describe('Unsubscribe', () => {
    beforeEach(async () => {
      mockWatchmanInstance.command.mockImplementation((args, callback) => {
        if (args[0] === 'watch-project') {
          callback(null, { watch: '/test/project' });
        } else if (args[0] === 'subscribe') {
          callback(null, {});
        } else if (args[0] === 'unsubscribe') {
          callback(null, {});
        }
      });

      await client.connect();
      await client.watchProject('/test/project');
    });

    it('should unsubscribe from watches', async () => {
      // First subscribe
      await client.subscribe(
        '/test/project',
        'test-subscription',
        {
          expression: ['match', '**/*.js', 'wholename'],
          fields: ['name', 'exists'],
        },
        vi.fn()
      );

      vi.clearAllMocks();

      // Then unsubscribe
      await client.unsubscribe('test-subscription');

      expect(mockWatchmanInstance.command).toHaveBeenCalledWith(
        ['unsubscribe', '/test/project', 'test-subscription'],
        expect.any(Function)
      );
    });

    it('should handle unsubscribe errors gracefully', async () => {
      // First subscribe
      await client.subscribe(
        '/test/project',
        'test-subscription',
        {
          expression: ['match', '**/*.js', 'wholename'],
          fields: ['name', 'exists'],
        },
        vi.fn()
      );

      mockWatchmanInstance.command.mockImplementation((args, callback) => {
        if (args[0] === 'unsubscribe') {
          callback(new Error('Unsubscribe failed'), null);
        }
      });

      // Should not throw
      await expect(client.unsubscribe('test-subscription')).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to unsubscribe test-subscription')
      );
    });
  });

  describe('Disconnect', () => {
    beforeEach(async () => {
      mockWatchmanInstance.command.mockImplementation((args, callback) => {
        if (args[0] === 'watch-project') {
          callback(null, { watch: '/test/project' });
        } else if (args[0] === 'subscribe') {
          callback(null, {});
        } else if (args[0] === 'unsubscribe') {
          callback(null, {});
        } else if (args[0] === 'watch-del') {
          callback(null, {});
        }
      });

      await client.connect();
      await client.watchProject('/test/project');
    });

    it('should disconnect cleanly', async () => {
      // Add a subscription
      await client.subscribe(
        '/test/project',
        'test-subscription',
        {
          expression: ['match', '**/*.js', 'wholename'],
          fields: ['name', 'exists'],
        },
        vi.fn()
      );

      await client.disconnect();

      // Should unsubscribe
      expect(mockWatchmanInstance.command).toHaveBeenCalledWith(
        ['unsubscribe', '/test/project', 'test-subscription'],
        expect.any(Function)
      );

      // Should remove watch
      expect(mockWatchmanInstance.command).toHaveBeenCalledWith(
        ['watch-del', '/test/project'],
        expect.any(Function)
      );

      // Should end client
      expect(mockWatchmanInstance.end).toHaveBeenCalled();
    });
  });

  describe('Connection Status', () => {
    it('should report disconnected initially', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should report connected after watching a project', async () => {
      mockWatchmanInstance.command.mockImplementation((args, callback) => {
        if (args[0] === 'watch-project') {
          callback(null, { watch: '/test/project' });
        }
      });

      await client.connect();
      await client.watchProject('/test/project');

      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should emit error events', () => {
      const errorHandler = vi.fn();
      client.on('error', errorHandler);

      // Trigger error event
      const errorCallback = mockWatchmanInstance.on.mock.calls.find(
        (call) => call[0] === 'error'
      )?.[1];

      const testError = new Error('Test error');
      errorCallback?.(testError);

      expect(mockLogger.error).toHaveBeenCalledWith('Watchman client error:', testError);
      expect(errorHandler).toHaveBeenCalledWith(testError);
    });

    it('should emit disconnected events', () => {
      const disconnectHandler = vi.fn();
      client.on('disconnected', disconnectHandler);

      // Trigger end event
      const endCallback = mockWatchmanInstance.on.mock.calls.find((call) => call[0] === 'end')?.[1];

      endCallback?.();

      expect(mockLogger.error).toHaveBeenCalledWith('Watchman connection ended unexpectedly');
      expect(disconnectHandler).toHaveBeenCalled();
    });
  });
});
