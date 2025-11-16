import { describe, expect, it } from 'vitest';
import { FileSystemUtils } from '../../src/utils/filesystem.js';
import { DEFAULT_LOG_CHANNEL } from '../../src/utils/log-channels.js';

describe('FileSystemUtils log channels', () => {
  const projectRoot = '/repo/example';
  const target = 'web';

  it('keeps legacy filename when channel is default', () => {
    const result = FileSystemUtils.generateLogFileName(projectRoot, target, DEFAULT_LOG_CHANNEL);
    expect(result).toMatch(/web\.log$/);
    expect(result).not.toContain('tests.log');
  });

  it('appends sanitized channel when non-default', () => {
    const result = FileSystemUtils.generateLogFileName(projectRoot, target, 'integration tests');
    expect(result).toMatch(/web-integration-tests\.log$/);
  });

  it('getLogFilePath mirrors generateLogFileName', () => {
    const path = FileSystemUtils.getLogFilePath(projectRoot, target, 'unit');
    expect(path.endsWith('web-unit.log')).toBe(true);
  });
});
