// Poltergeist v1.0 - Watchman client for generic target system

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
      this.logger.error('Watchman client error:', err);
      this.emit('error', err);
    });

    this.client.on('end', () => {
      this.logger.error('Watchman connection ended unexpectedly');
      this.emit('disconnected');
    });

    this.client.on('subscription', (data: unknown) => {
      this.logger.debug(`Raw subscription event received: ${JSON.stringify(data)}`);
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
    callback: (files: Array<{ name: string; exists: boolean; type?: string }>) => void,
    exclusionExpressions?: Array<[string, string[]]>
  ): Promise<void> {
    if (!this.watchRoot) {
      throw new Error('No project is being watched');
    }

    this.logger.debug(`Creating subscription ${subscriptionName}`);

    // Build the expression with provided exclusions
    let enhancedExpression: any;
    
    if (exclusionExpressions && exclusionExpressions.length > 0) {
      // Build proper Watchman expression: ["allof", originalExpression, ...exclusions]
      // Use any to handle complex nested Watchman expression structure
      enhancedExpression = [
        'allof',
        subscription.expression,  // Original expression as single element
        ...exclusionExpressions   // Exclusion expressions as separate elements
      ];
      this.logger.debug(`Applied ${exclusionExpressions.length} exclusion expressions`);
    } else {
      // No exclusions, use original expression
      enhancedExpression = subscription.expression;
      this.logger.debug('No exclusion expressions provided, using original expression');
    }

    const enhancedSubscription = {
      ...subscription,
      expression: enhancedExpression,
    };

    this.logger.debug(`Subscription expression: ${JSON.stringify(enhancedExpression)}`);

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

          this.logger.debug(`Subscription ${subscriptionName} received ${changes.length} file changes: ${changes.map(c => c.name).join(', ')}`);
          callback(changes);
        }
      };

      // Register the handler
      this.client.on('subscription', handler);

      // Create the subscription
      this.logger.debug(`Sending subscribe command: ${JSON.stringify(['subscribe', this.watchRoot, subscriptionName, enhancedSubscription])}`);
      this.client.command(
        ['subscribe', this.watchRoot, subscriptionName, enhancedSubscription],
        (error: Error | null, resp?: unknown) => {
          if (error) {
            this.logger.error(`Subscription creation failed: ${error.message}`);
            this.client.removeListener('subscription', handler);
            reject(new Error(`Failed to create subscription: ${error.message}`));
            return;
          }

          this.logger.debug(`Subscription response: ${JSON.stringify(resp)}`);
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
