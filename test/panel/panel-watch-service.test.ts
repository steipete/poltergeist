import type { FSWatcher } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { PanelWatchService } from '../../src/panel/panel-watch-service.js';

class FakeWatcher implements FSWatcher {
  close = vi.fn();
  // Unused FSWatcher members
  addListener = vi.fn() as any;
  on = vi.fn() as any;
  once = vi.fn() as any;
  removeListener = vi.fn() as any;
  setMaxListeners = vi.fn() as any;
  getMaxListeners = vi.fn() as any;
  listeners = vi.fn() as any;
  rawListeners = vi.fn() as any;
  emit = vi.fn() as any;
  listenerCount = vi.fn() as any;
  prependListener = vi.fn() as any;
  prependOnceListener = vi.fn() as any;
  removeAllListeners = vi.fn() as any;
  eventNames = vi.fn() as any;
}

describe('panel-watch-service', () => {
  it('wires state and config watchers and forwards callbacks', () => {
    const fakeStateWatcher = new FakeWatcher();
    const fakeConfigWatcher = new FakeWatcher();
    const listeners: Array<(event: string, filename?: string | Buffer) => void> = [];
    const calls: { state: number; config: number } = { state: 0, config: 0 };

    const watchFactory = vi
      .fn<
        (path: string, listener: (event: string, filename?: string | Buffer) => void) => FSWatcher
      >()
      .mockImplementation((path, listener) => {
        listeners.push(listener);
        return path.includes('config') ? fakeConfigWatcher : fakeStateWatcher;
      });

    const service = new PanelWatchService({
      stateDir: '/tmp/state',
      configPath: '/tmp/config',
      logger: { warn: vi.fn() },
      onStateChange: () => calls.state++,
      onConfigChange: () => calls.config++,
      watchFactory,
    });

    service.start();
    expect(watchFactory).toHaveBeenCalledTimes(2);

    // trigger callbacks
    listeners[0]('change', 'file');
    listeners[1]('change', 'config');
    expect(calls).toEqual({ state: 1, config: 1 });

    service.stop();
    expect(fakeStateWatcher.close).toHaveBeenCalled();
    expect(fakeConfigWatcher.close).toHaveBeenCalled();
  });
});
