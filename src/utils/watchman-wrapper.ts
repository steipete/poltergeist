//
//  watchman-wrapper.ts
//  Poltergeist
//

/**
 * ESM wrapper for fb-watchman CommonJS module.
 * Uses dynamic import to load the CommonJS module lazily,
 * allowing Bun bytecode compilation to proceed.
 */

export interface WatchmanCapabilities {
  optional: string[];
  required?: string[];
}

export interface WatchmanExpression {
  expression: any[];
  fields: string[];
}

export interface WatchmanSubscribeOptions extends WatchmanExpression {
  since?: string;
  relative_root?: string;
  defer?: string[];
  drop?: string[];
}

export type WatchmanCallback = (error: Error | null, resp?: any) => void;

class WatchmanClientWrapper {
  private clientModule: any = null;
  private client: any = null;
  private loadAttempted = false;

  /**
   * Lazily loads the fb-watchman module and creates a client.
   * Falls back gracefully if the module is not available.
   */
  private async loadWatchman(): Promise<any> {
    if (this.loadAttempted) {
      return this.client;
    }

    this.loadAttempted = true;

    try {
      // Dynamic import of CommonJS module
      // This allows Bun to compile without the dependency
      const watchman = await import('fb-watchman');
      this.clientModule = watchman.default || watchman;

      // Create the watchman client
      this.client = new this.clientModule.Client();
      return this.client;
    } catch (error) {
      console.error('fb-watchman not available:', error);
      throw new Error('Watchman is required for file watching. Please install fb-watchman.');
    }
  }

  /**
   * Capability check - mirrors fb-watchman API
   */
  async capabilityCheck(
    capabilities: WatchmanCapabilities,
    callback: WatchmanCallback
  ): Promise<void> {
    try {
      const client = await this.loadWatchman();
      client.capabilityCheck(capabilities, callback);
    } catch (error) {
      callback(error as Error);
    }
  }

  /**
   * Execute a watchman command
   */
  async command(cmd: any[], callback: WatchmanCallback): Promise<void> {
    try {
      const client = await this.loadWatchman();
      client.command(cmd, callback);
    } catch (error) {
      callback(error as Error);
    }
  }

  /**
   * Subscribe to file changes
   */
  async subscribe(
    root: string,
    name: string,
    options: WatchmanSubscribeOptions,
    callback: WatchmanCallback
  ): Promise<void> {
    try {
      const client = await this.loadWatchman();

      // Build the subscription command
      const sub: any = {
        expression: options.expression,
        fields: options.fields,
      };

      // Add optional fields if present
      if (options.since) sub.since = options.since;
      if (options.relative_root) sub.relative_root = options.relative_root;
      if (options.defer) sub.defer = options.defer;
      if (options.drop) sub.drop = options.drop;

      client.command(['subscribe', root, name, sub], callback);
    } catch (error) {
      callback(error as Error);
    }
  }

  /**
   * Unsubscribe from file changes
   */
  async unsubscribe(root: string, name: string, callback: WatchmanCallback): Promise<void> {
    try {
      const client = await this.loadWatchman();
      client.command(['unsubscribe', root, name], callback);
    } catch (error) {
      callback(error as Error);
    }
  }

  /**
   * End the client connection
   */
  async end(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }

  /**
   * Add event listener to the client
   * Note: This needs to work synchronously for compatibility
   */
  on(event: string, handler: (...args: any[]) => void): void {
    // Store handlers to apply when client is loaded
    if (!this.client) {
      // Load client asynchronously but don't await
      this.loadWatchman()
        .then((client) => {
          if (client) {
            client.on(event, handler);
          }
        })
        .catch((error) => {
          console.error('Failed to add event listener:', error);
        });
    } else {
      this.client.on(event, handler);
    }
  }

  /**
   * Remove event listener from the client
   */
  removeListener(event: string, handler: (...args: any[]) => void): void {
    if (this.client) {
      this.client.removeListener(event, handler);
    }
  }

  /**
   * Check if watchman is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.loadWatchman();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Factory function to create a new WatchmanClient instance.
 * Mirrors the fb-watchman API.
 */
export function createWatchmanClient(): WatchmanClientWrapper {
  return new WatchmanClientWrapper();
}

// Also export the class for direct instantiation if needed
export { WatchmanClientWrapper };

// Default export for convenience
export default { createWatchmanClient, WatchmanClientWrapper };
