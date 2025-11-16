import { describe, expect, it } from 'vitest';
import {
  cycleChannelIndex,
  DEFAULT_LOG_CHANNEL,
  normalizeLogChannels,
  sanitizeLogChannel,
} from '../../src/utils/log-channels';

describe('log channel utilities', () => {
  it('always includes the default build channel first', () => {
    expect(normalizeLogChannels()).toEqual([DEFAULT_LOG_CHANNEL]);
    expect(normalizeLogChannels(['unit'])).toEqual([DEFAULT_LOG_CHANNEL, 'unit']);
  });

  it('deduplicates channels case-insensitively and sanitizes names', () => {
    expect(normalizeLogChannels(['Build', 'unit', 'unit', 'integration-1'])).toEqual([
      DEFAULT_LOG_CHANNEL,
      'unit',
      'integration-1',
    ]);
    expect(sanitizeLogChannel('integration logs')).toBe('integration-logs');
  });

  it('cycles channel indices in both directions', () => {
    const channels = ['build', 'unit', 'integration'];
    expect(cycleChannelIndex(channels, 0, 'next')).toBe(1);
    expect(cycleChannelIndex(channels, 2, 'next')).toBe(0);
    expect(cycleChannelIndex(channels, 0, 'prev')).toBe(2);
  });
});
