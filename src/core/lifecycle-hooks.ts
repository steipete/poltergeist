import type { Logger } from '../logger.js';

interface LifecycleHooksDeps {
  logger: Logger;
}

export class LifecycleHooks {
  private readonly logger: Logger;
  private readyHandlers: Array<() => void> = [];
  private isReady = false;

  constructor(deps: LifecycleHooksDeps) {
    this.logger = deps.logger;
  }

  public onReady(handler: () => void): void {
    if (this.isReady) {
      try {
        handler();
      } catch (error) {
        this.logger.error('Ready handler failed:', error);
      }
      return;
    }
    this.readyHandlers.push(handler);
  }

  public notifyReady(): void {
    if (this.isReady) return;
    this.isReady = true;
    const handlers = this.readyHandlers.slice();
    this.readyHandlers = [];
    for (const handler of handlers) {
      try {
        handler();
      } catch (error) {
        this.logger.error('Ready handler failed:', error);
      }
    }
  }
}
