import watchman from 'fb-watchman';
import { EventEmitter } from 'events';
import { Logger } from 'winston';
import type { FileChange, BuildTarget } from './types.js';

export interface WatchmanTrigger {
  name: string;
  expression: any[];
  command: string[];
  append_files: boolean;
  stdin: string[];
  settling_delay: number;
}

export class WatchmanClient extends EventEmitter {
  private client: watchman.Client;
  private watchRoot?: string;
  private subscriptions: Map<string, string> = new Map();

  constructor(private logger: Logger) {
    super();
    this.client = new watchman.Client();
    
    // Set up the subscription handler once for all subscriptions
    this.client.on('subscription', (resp: any) => {
      // Find which target this subscription is for
      for (const [target, subName] of this.subscriptions) {
        if (resp.subscription === subName) {
          const changes: FileChange[] = resp.files.map((file: any) => ({
            path: file.name,
            exists: file.exists,
            new: file.new,
            size: file.size,
            mode: file.mode,
          }));
          
          this.logger.debug(`[${target}] Watchman detected ${changes.length} file changes`);
          this.emit('changes', target, changes);
          break;
        }
      }
    });
    
    this.client.on('error', (error) => {
      this.logger.error('Watchman error:', error);
      this.emit('error', error);
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
        (error) => {
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
      this.client.command(['watch-project', projectRoot], (error: Error | null, resp: any) => {
        if (error) {
          reject(new Error(`Failed to watch project: ${error.message}`));
          return;
        }
        
        this.watchRoot = resp.watch;
        this.logger.info(`Watching project at: ${this.watchRoot}`);
        resolve();
      });
    });
  }

  async subscribe(
    target: BuildTarget,
    paths: string[],
    settlingDelay: number
  ): Promise<void> {
    if (!this.watchRoot) {
      throw new Error('No project is being watched');
    }

    const subscriptionName = `poltergeist-${target}`;
    
    this.logger.debug(`Creating subscription ${subscriptionName} for paths:`, paths);
    
    // Build the expression for matching files
    const pathExpressions = paths.map(path => ['match', path, 'wholename']);
    const expression = ['allof', 
      ['anyof', ...pathExpressions],
      // Exclude auto-generated files
      ['not', ['match', '**/.build/**', 'wholename']],
      ['not', ['match', '**/DerivedData/**', 'wholename']]
    ];
    
    this.logger.debug(`Subscription expression:`, JSON.stringify(expression, null, 2));

    const subscription = {
      expression,
      fields: ['name', 'exists', 'new', 'size', 'mode'],
      defer: ['hg.update'],
      drop: ['hg.update'],
      settle: settlingDelay,
    };

    return new Promise((resolve, reject) => {
      this.client.command(
        ['subscribe', this.watchRoot, subscriptionName, subscription] as any,
        (error: Error | null, _resp: any) => {
          if (error) {
            reject(new Error(`Failed to create subscription: ${error.message}`));
            return;
          }

          this.subscriptions.set(target, subscriptionName);
          this.logger.info(`Created subscription: ${subscriptionName}`);
          this.logger.debug(`Watching paths: ${paths.join(', ')}`);
          
          resolve();
        }
      );
    });
  }

  async unsubscribe(target: BuildTarget): Promise<void> {
    const subscriptionName = this.subscriptions.get(target);
    if (!subscriptionName || !this.watchRoot) {
      return;
    }

    return new Promise((resolve) => {
      this.client.command(
        ['unsubscribe', this.watchRoot, subscriptionName] as any,
        (error: Error | null) => {
          if (error) {
            this.logger.warn(`Failed to unsubscribe ${subscriptionName}: ${error.message}`);
          }
          this.subscriptions.delete(target);
          resolve();
        }
      );
    });
  }

  async shutdown(): Promise<void> {
    // Unsubscribe from all subscriptions
    for (const target of this.subscriptions.keys()) {
      await this.unsubscribe(target as BuildTarget);
    }

    // Remove the watch
    if (this.watchRoot) {
      await new Promise<void>((resolve) => {
        this.client.command(['watch-del', this.watchRoot] as any, () => {
          resolve();
        });
      });
    }

    // End the client connection
    this.client.end();
  }

  isConnected(): boolean {
    // fb-watchman doesn't expose readyState, so we'll track connection status differently
    return this.watchRoot !== undefined;
  }
}