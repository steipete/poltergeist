import { describe, expect, it, vi } from 'vitest';
import { LifecycleHooks } from '../src/core/lifecycle-hooks.js';

const logger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
};

describe('LifecycleHooks', () => {
  it('runs handlers once when ready is notified', () => {
    const hooks = new LifecycleHooks({ logger });
    const handler = vi.fn();
    hooks.onReady(handler);

    hooks.notifyReady();
    hooks.notifyReady(); // second call should be no-op

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('immediately invokes handler if already ready', () => {
    const hooks = new LifecycleHooks({ logger });
    hooks.notifyReady();
    const handler = vi.fn();
    hooks.onReady(handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('logs errors thrown by handlers', () => {
    const hooks = new LifecycleHooks({ logger });
    const erroring = vi.fn(() => {
      throw new Error('boom');
    });
    hooks.onReady(erroring);
    hooks.notifyReady();
    expect(logger.error).toHaveBeenCalledWith('Ready handler failed:', expect.any(Error));
  });
});
