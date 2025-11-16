export const DEFAULT_LOG_CHANNEL = 'build';

const sanitizeSegment = (value: string): string => {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[^a-zA-Z0-9._-]/g, '-');
  return sanitized.length > 0 ? sanitized : 'channel';
};

export const normalizeLogChannels = (input?: string[]): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const sanitized = sanitizeSegment(raw);
    const key = sanitized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(sanitized);
  };

  add(DEFAULT_LOG_CHANNEL);
  (input ?? []).forEach(add);

  return result;
};

export const cycleChannelIndex = (
  channels: readonly string[],
  currentIndex: number,
  direction: 'next' | 'prev'
): number => {
  if (channels.length === 0) return 0;
  const count = channels.length;
  const delta = direction === 'next' ? 1 : -1;
  const next = (((currentIndex + delta) % count) + count) % count;
  return next;
};

export const sanitizeLogChannel = sanitizeSegment;
