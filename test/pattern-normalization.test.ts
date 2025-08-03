import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchmanConfigManager } from '../src/watchman-config.js';
import { createMockLogger } from './helpers.js';

describe('Pattern Normalization', () => {
  let manager: WatchmanConfigManager;
  beforeEach(() => {
    const logger = createMockLogger();
    manager = new WatchmanConfigManager('/tmp/test-project', logger);
  });

  describe('normalizeWatchPattern', () => {
    it('should convert *.js to **/*.js', () => {
      expect(manager.normalizeWatchPattern('*.js')).toBe('**/*.js');
    });

    it('should convert *.ts to **/*.ts', () => {
      expect(manager.normalizeWatchPattern('*.ts')).toBe('**/*.ts');
    });

    it('should convert ./*.js to **/*.js', () => {
      expect(manager.normalizeWatchPattern('./*.js')).toBe('**/*.js');
    });

    it('should convert src/*.js to src/**/*.js', () => {
      expect(manager.normalizeWatchPattern('src/*.js')).toBe('src/**/*.js');
    });

    it('should convert lib/*.ts to lib/**/*.ts', () => {
      expect(manager.normalizeWatchPattern('lib/*.ts')).toBe('lib/**/*.ts');
    });

    it('should convert trailing slash src/ to src/**', () => {
      expect(manager.normalizeWatchPattern('src/')).toBe('src/**');
    });

    it('should leave **/*.js unchanged', () => {
      expect(manager.normalizeWatchPattern('**/*.js')).toBe('**/*.js');
    });

    it('should leave src/**/*.ts unchanged', () => {
      expect(manager.normalizeWatchPattern('src/**/*.ts')).toBe('src/**/*.ts');
    });

    it('should leave specific file paths unchanged', () => {
      expect(manager.normalizeWatchPattern('package.json')).toBe('package.json');
      expect(manager.normalizeWatchPattern('./package.json')).toBe('./package.json');
      expect(manager.normalizeWatchPattern('src/index.ts')).toBe('src/index.ts');
    });

    it('should handle complex patterns unchanged', () => {
      expect(manager.normalizeWatchPattern('src/**/test/*.spec.ts')).toBe('src/**/test/*.spec.ts');
      expect(manager.normalizeWatchPattern('**/*.{js,ts}')).toBe('**/*.{js,ts}');
    });

    it('should throw on empty pattern', () => {
      expect(() => manager.normalizeWatchPattern('')).toThrow(
        'Watch pattern must be a non-empty string'
      );
    });

    it('should throw on non-string pattern', () => {
      expect(() => manager.normalizeWatchPattern(null as unknown as string)).toThrow(
        'Watch pattern must be a non-empty string'
      );
      expect(() => manager.normalizeWatchPattern(undefined as unknown as string)).toThrow(
        'Watch pattern must be a non-empty string'
      );
    });
  });

  describe('validateWatchPattern after normalization', () => {
    it('should accept normalized patterns', () => {
      expect(() => manager.validateWatchPattern('**/*.js')).not.toThrow();
      expect(() => manager.validateWatchPattern('src/**/*.ts')).not.toThrow();
      expect(() => manager.validateWatchPattern('package.json')).not.toThrow();
    });

    it('should warn about problematic patterns', () => {
      const logger = createMockLogger();
      const warnSpy = vi.spyOn(logger, 'warn');
      const testManager = new WatchmanConfigManager('/tmp/test-project', logger);

      testManager.validateWatchPattern('.git/**');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('commonly excluded directory'));

      testManager.validateWatchPattern('node_modules/**');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('commonly excluded directory'));
    });
  });

  describe('integration with pattern processing', () => {
    it('should normalize patterns in real usage', () => {
      // Test that common user patterns work after normalization
      const patterns = [
        { input: '*.js', expected: '**/*.js' },
        { input: '*.swift', expected: '**/*.swift' },
        { input: './*.go', expected: '**/*.go' },
        { input: 'src/*.rs', expected: 'src/**/*.rs' },
        { input: 'tests/', expected: 'tests/**' },
      ];

      patterns.forEach(({ input, expected }) => {
        const normalized = manager.normalizeWatchPattern(input);
        expect(normalized).toBe(expected);
        // Should not throw after normalization
        expect(() => manager.validateWatchPattern(normalized)).not.toThrow();
      });
    });
  });
});
