// Poltergeist v1.0 - Watchman client for generic target system

import { EventEmitter } from 'events';
import type { Logger } from './logger.js';
import { createWatchmanClient } from './utils/watchman-wrapper.js';

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

// Note: fb-watchman client is now loaded dynamically via watchman-wrapper
// to support Bun bytecode compilation

export class WatchmanClient extends EventEmitter {
  private client: any;
  private watchRoot?: string;
  private logger: Logger;
  private subscriptions: Map<string, string> = new Map();
  private clock?: string;  // Track the clock for incremental updates

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.client = createWatchmanClient();
    
    // Add global subscription logging for debugging
    this.client.on('subscription', (data: unknown) => {
      this.logger.debug(`[GLOBAL] Received subscription event: ${JSON.stringify(data)}`);
    });

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
      // Use INFO level to ensure we see this
      this.logger.info(`[GLOBAL] Raw subscription event received: ${JSON.stringify(data).substring(0, 200)}`);
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
        
        // Get the initial clock for this watch
        this.client.command(['clock', this.watchRoot], (clockError: Error | null, clockResp?: unknown) => {
          if (clockError) {
            this.logger.warn(`Failed to get initial clock: ${clockError.message}`);
            // Continue without clock - will get full sync on first subscription
            resolve();
            return;
          }
          
          const clockData = clockResp as { clock: string };
          this.clock = clockData.clock;
          this.logger.debug(`Initial clock obtained: ${this.clock}`);
          resolve();
        });
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
    let enhancedExpression: Array<string | unknown>;

    if (exclusionExpressions && exclusionExpressions.length > 0) {
      // Build proper Watchman expression: ["allof", originalExpression, ...exclusions]
      // Use any to handle complex nested Watchman expression structure
      enhancedExpression = [
        'allof',
        subscription.expression, // Original expression as single element
        ...exclusionExpressions, // Exclusion expressions as separate elements
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
      // Use the clock if available for incremental updates
      ...(this.clock ? { since: this.clock } : {}),
    };

    this.logger.debug(`Subscription expression: ${JSON.stringify(enhancedExpression)}`);
    if (this.clock) {
      this.logger.debug(`Using clock for incremental updates: ${this.clock}`);
    } else {
      this.logger.debug('No clock available, will receive initial full sync');
    }

    return new Promise((resolve, reject) => {
      // Set up the subscription handler for this specific subscription
      const handler = (data: unknown) => {
        // Log complete event at INFO level for debugging
        const eventStr = JSON.stringify(data);
        this.logger.debug(`[HANDLER-${subscriptionName}] Watchman event: ${eventStr}`);
        
        const resp = data as {
          subscription: string;
          files?: Array<{
            name: string;
            exists: boolean;
            new?: boolean;
            size?: number;
            mode?: number;
          }>;
          state?: string;
          is_fresh_instance?: boolean;
          clock?: string;
          unilateral?: boolean;
        };

        if (resp.subscription === subscriptionName) {
          this.logger.info(`[MATCH] Subscription ${subscriptionName} matched!`);
          
          // Log all fields for debugging
          this.logger.info(`  unilateral: ${resp.unilateral}, is_fresh: ${resp.is_fresh_instance}, state: ${resp.state}, files: ${resp.files?.length || 0}`);
          
          // Update the clock for next incremental update
          if (resp.clock) {
            this.clock = resp.clock;
            this.logger.debug(`Updated clock to: ${this.clock}`);
          }
          
          // Handle state-enter/state-leave events from Watchman
          if (resp.state) {
            this.logger.info(
              `  State change: ${resp.state}`
            );
            return;
          }

          // Only process if files array exists
          if (!resp.files || resp.files.length === 0) {
            this.logger.info(
              `  No files in event`
            );
            return;
          }

          const changes = resp.files.map((file) => ({
            name: file.name,
            exists: file.exists,
            type: file.new ? 'new' : undefined,
          }));

          this.logger.info(
            `  Processing ${changes.length} file changes`
          );
          callback(changes);
        } else {
          this.logger.info(`[SKIP] Event for different subscription: ${resp.subscription} (wanted: ${subscriptionName})`);
        }
      };

      // Register the handler
      this.logger.debug(`Registering handler for subscription: ${subscriptionName}`);
      this.client.on('subscription', handler);
      // Note: fb-watchman Client doesn't have listenerCount, so we skip this debug log

      // Create the subscription
      this.logger.debug(
        `Sending subscribe command: ${JSON.stringify(['subscribe', this.watchRoot, subscriptionName, enhancedSubscription])}`
      );
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
          this.logger.debug(`Active subscriptions: ${Array.from(this.subscriptions.keys()).join(', ')}`);
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
