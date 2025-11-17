import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelScheduler } from '../../src/panel/panel-scheduler.js';

describe('panel-scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks status and git callbacks on intervals and stops cleanly', () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const onGit = vi.fn();

    const scheduler = new PanelScheduler({
      statusPollMs: 1000,
      gitPollMs: 2000,
      onStatus,
      onGit,
    });

    scheduler.start();
    vi.advanceTimersByTime(1000);
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onGit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onGit).toHaveBeenCalledTimes(1);

    scheduler.stop();
    vi.advanceTimersByTime(4000);
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onGit).toHaveBeenCalledTimes(1);
  });
});
