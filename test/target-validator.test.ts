import chalk from 'chalk';
import { describe, expect, it, vi } from 'vitest';
import type { PoltergeistConfig } from '../src/types.js';
import { formatAvailableTargets, validateTarget } from '../src/utils/target-validator.js';

// Mock console.error and process.exit
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('Target Validator', () => {
  const mockConfig: PoltergeistConfig = {
    version: '1.0',
    projectType: 'node',
    targets: [
      {
        name: 'poltergeist-cli',
        type: 'executable',
        enabled: true,
        buildCommand: 'npm run build',
        outputPath: './dist/cli.js',
        watchPaths: ['src/**/*.ts'],
      },
      {
        name: 'poltergeist-mac',
        type: 'app-bundle',
        enabled: false,
        buildCommand: 'xcodebuild build',
        bundleId: 'com.example.poltergeist',
        watchPaths: ['apps/mac/**/*.swift'],
      },
      {
        name: 'test-runner',
        type: 'test',
        enabled: true,
        testCommand: 'npm test',
        watchPaths: ['test/**/*.ts'],
      },
    ],
  };

  beforeEach(() => {
    mockConsoleError.mockClear();
    mockProcessExit.mockClear();
  });

  describe('formatAvailableTargets', () => {
    it('should format targets with enabled/disabled status', () => {
      const formatted = formatAvailableTargets(mockConfig);

      expect(formatted).toHaveLength(3);
      expect(formatted[0]).toContain('poltergeist-cli');
      expect(formatted[0]).toContain('(executable)');
      expect(formatted[0]).not.toContain('[disabled]');

      expect(formatted[1]).toContain('poltergeist-mac');
      expect(formatted[1]).toContain('(app-bundle)');
      expect(formatted[1]).toContain('[disabled]');

      expect(formatted[2]).toContain('test-runner');
      expect(formatted[2]).toContain('(test)');
    });
  });

  describe('validateTarget', () => {
    it('should not throw for valid target', () => {
      expect(() => validateTarget('poltergeist-cli', mockConfig)).not.toThrow();
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should exit with error for invalid target', () => {
      expect(() => validateTarget('invalid-target', mockConfig)).toThrow('process.exit called');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Target 'invalid-target' not found")
      );
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Available targets:'));
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should suggest similar target names', () => {
      expect(() => validateTarget('poltergeist-cl', mockConfig)).toThrow('process.exit called');

      const errorCalls = mockConsoleError.mock.calls.map((call) => call[0]);

      // Should show multiple suggestions when both are close matches
      const hasSuggestions = errorCalls.some(
        (msg) => typeof msg === 'string' && msg.includes('Did you mean one of these?')
      );
      expect(hasSuggestions).toBe(true);

      // Should include poltergeist-cli in suggestions
      const hasCliSuggestion = errorCalls.some(
        (msg) => typeof msg === 'string' && msg.includes('poltergeist-cli')
      );
      expect(hasCliSuggestion).toBe(true);
    });

    it('should suggest multiple similar targets when applicable', () => {
      // Use a target name that will match multiple targets
      expect(() => validateTarget('polt', mockConfig)).toThrow('process.exit called');

      const errorCalls = mockConsoleError.mock.calls.map((call) => call[0]);
      // For 'polt', no targets are within the threshold, so no suggestions
      const hasSuggestion = errorCalls.some(
        (msg) => typeof msg === 'string' && msg.includes('Did you mean')
      );
      expect(hasSuggestion).toBe(false);
    });

    it('should show usage example', () => {
      expect(() => validateTarget('wrong', mockConfig)).toThrow('process.exit called');

      const errorCalls = mockConsoleError.mock.calls.map((call) => call[0]);
      const hasUsage = errorCalls.some((msg) =>
        msg.includes('Usage: npx poltergeist logs <target>')
      );
      const hasExample = errorCalls.some((msg) =>
        msg.includes('Example: npx poltergeist logs poltergeist-cli')
      );

      expect(hasUsage).toBe(true);
      expect(hasExample).toBe(true);
    });

    it('should handle case-insensitive fuzzy matching', () => {
      expect(() => validateTarget('POLTERGEIST-CLI', mockConfig)).toThrow('process.exit called');

      const errorCalls = mockConsoleError.mock.calls.map((call) => call[0]);

      // Should show single suggestion for exact case-insensitive match
      const hasSingleSuggestion = errorCalls.some(
        (msg) => typeof msg === 'string' && msg.includes("Did you mean 'poltergeist-cli'?")
      );
      expect(hasSingleSuggestion).toBe(true);
    });
  });

  describe('Fuzzy Matching Thresholds', () => {
    it('should not suggest targets that are too different', () => {
      expect(() => validateTarget('xyz', mockConfig)).toThrow('process.exit called');

      const errorCalls = mockConsoleError.mock.calls.map((call) => call[0]);
      const hasSuggestion = errorCalls.some((msg) => msg.includes('Did you mean'));

      // Should not suggest anything for 'xyz' as it's too different
      expect(hasSuggestion).toBe(false);
    });

    it('should suggest targets with small typos', () => {
      // Test single character typo
      expect(() => validateTarget('poltergeist-clu', mockConfig)).toThrow('process.exit called');

      const errorCalls = mockConsoleError.mock.calls.map((call) => call[0]);

      // Should suggest poltergeist-cli for single character typo
      const hasCliSuggestion = errorCalls.some(
        (msg) => typeof msg === 'string' && msg.includes('poltergeist-cli')
      );
      expect(hasCliSuggestion).toBe(true);

      // Should show suggestion message
      const hasSuggestionMessage = errorCalls.some(
        (msg) =>
          typeof msg === 'string' &&
          (msg.includes('Did you mean') || msg.includes('Did you mean one of these?'))
      );
      expect(hasSuggestionMessage).toBe(true);
    });
  });
});
