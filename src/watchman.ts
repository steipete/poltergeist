// Updated Watchman client for generic target system

import { EventEmitter } from 'events';
import watchman from 'fb-watchman';
import type { Logger } from './logger.js';

export interface FileChange {
  path: string;
  exists: boolean;
  new?: boolean;
  size?: number;
  mode?: number;
}

export interface WatchSubscription {
  expression: Array<string | Array<string>>;
  fields: string[];
  defer?: string[];
  drop?: string[];
  settle?: number;
}

// Custom type definition for fb-watchman client
interface FBWatchmanClient {
  capabilityCheck(
    options: { optional: string[]; required: string[] },
    callback: (error: Error | null, resp?: unknown) => void
  ): void;
  command(args: unknown[], callback: (error: Error | null, resp?: unknown) => void): void;
  on(event: string, handler: (data: unknown) => void): this;
  removeListener(event: string, handler: (data: unknown) => void): this;
  end(): void;
}

export class WatchmanClient extends EventEmitter {
  private client: FBWatchmanClient;
  private watchRoot?: string;
  private logger: Logger;
  private subscriptions: Map<string, string> = new Map();

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.client = new watchman.Client() as FBWatchmanClient;

    this.client.on('error', (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Watchman error:', err);
      this.emit('error', err);
    });

    this.client.on('end', () => {
      this.logger.info('Watchman connection ended');
      this.emit('disconnected');
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.capabilityCheck(
        { optional: [], required: ['relative_root'] },
        (error: Error | null) => {
          if (error) {
            reject(new Error(`Watchman capability check failed: ${error.message}`));
          } else {
            this.logger.info('Connected to Watchman');
            resolve();
          }
        }
      );
    });
  }

  async watchProject(projectRoot: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.command(['watch-project', projectRoot], (error: Error | null, resp?: unknown) => {
        if (error) {
          reject(new Error(`Failed to watch project: ${error.message}`));
          return;
        }

        const watchResp = resp as { watch: string };
        this.watchRoot = watchResp.watch;
        this.logger.info(`Watching project at: ${this.watchRoot}`);
        resolve();
      });
    });
  }

  async subscribe(
    projectRoot: string,
    subscriptionName: string,
    subscription: { expression: Array<string | Array<string>>; fields: string[] },
    callback: (files: Array<{ name: string; exists: boolean; type?: string }>) => void
  ): Promise<void> {
    if (!this.watchRoot) {
      throw new Error('No project is being watched');
    }

    this.logger.debug(`Creating subscription ${subscriptionName}`);

    // Add common exclusions to the expression
    const enhancedExpression = [
      'allof',
      subscription.expression,
      // Exclude common build directories
      ['not', ['match', '**/.build/**', 'wholename']],
      ['not', ['match', '**/DerivedData/**', 'wholename']],
      ['not', ['match', '**/node_modules/**', 'wholename']],
      ['not', ['match', '**/.git/**', 'wholename']],
    ];

    const enhancedSubscription = {
      ...subscription,
      expression: enhancedExpression,
    };

    return new Promise((resolve, reject) => {
      // Set up the subscription handler for this specific subscription
      const handler = (data: unknown) => {
        const resp = data as {
          subscription: string;
          files: Array<{
            name: string;
            exists: boolean;
            new?: boolean;
            size?: number;
            mode?: number;
          }>;
        };

        if (resp.subscription === subscriptionName) {
          const changes = resp.files.map((file) => ({
            name: file.name,
            exists: file.exists,
            type: file.new ? 'new' : undefined,
          }));

          callback(changes);
        }
      };

      // Register the handler
      this.client.on('subscription', handler);

      // Create the subscription
      this.client.command(
        ['subscribe', this.watchRoot, subscriptionName, enhancedSubscription],
        (error: Error | null) => {
          if (error) {
            this.client.removeListener('subscription', handler);
            reject(new Error(`Failed to create subscription: ${error.message}`));
            return;
          }

          this.subscriptions.set(subscriptionName, projectRoot);
          this.logger.info(`Subscription created: ${subscriptionName}`);
          resolve();
        }
      );
    });
  }

  async unsubscribe(subscriptionName: string): Promise<void> {
    if (!this.subscriptions.has(subscriptionName) || !this.watchRoot) {
      return;
    }

    return new Promise((resolve) => {
      this.client.command(
        ['unsubscribe', this.watchRoot, subscriptionName],
        (error: Error | null) => {
          if (error) {
            this.logger.warn(`Failed to unsubscribe ${subscriptionName}: ${error.message}`);
          }
          this.subscriptions.delete(subscriptionName);
          resolve();
        }
      );
    });
  }

  async disconnect(): Promise<void> {
    // Unsubscribe from all subscriptions
    for (const subscriptionName of this.subscriptions.keys()) {
      await this.unsubscribe(subscriptionName);
    }

    // Remove the watch
    if (this.watchRoot) {
      await new Promise<void>((resolve) => {
        this.client.command(['watch-del', this.watchRoot], () => {
          resolve();
        });
      });
    }

    // End the client connection
    this.client.end();
  }

  isConnected(): boolean {
    return this.watchRoot !== undefined;
  }
}
