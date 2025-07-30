// Comprehensive tests for Logger functionality

import { afterEach, beforeEach, describe, expect, it, type MockedFunction, vi } from 'vitest';
import winston from 'winston';
import {
  createConsoleLogger,
  createLogger,
  createTargetLogger,
  SimpleLogger,
  TargetLogger,
} from '../src/logger.js';

// Mock winston
vi.mock('winston', () => ({
  default: {
    createLogger: vi.fn(),
    format: {
      combine: vi.fn().mockImplementation((...args) => args),
      timestamp: vi.fn().mockImplementation((opts?: unknown) => ({ type: 'timestamp', opts })),
      errors: vi.fn().mockImplementation((opts?: unknown) => ({ type: 'errors', opts })),
      splat: vi.fn().mockImplementation(() => ({ type: 'splat' })),
      json: vi.fn().mockImplementation(() => ({ type: 'json' })),
      printf: vi.fn().mockImplementation((fn) => ({ type: 'printf', fn })),
    },
    transports: {
      Console: vi.fn().mockImplementation((opts) => ({ type: 'console', opts })),
      File: vi.fn().mockImplementation((opts) => ({ type: 'file', opts })),
    },
  },
}));

// Mock chalk for consistent output
vi.mock('chalk', () => ({
  default: {
    red: vi.fn((text) => `[RED]${text}[/RED]`),
    yellow: vi.fn((text) => `[YELLOW]${text}[/YELLOW]`),
    cyan: vi.fn((text) => `[CYAN]${text}[/CYAN]`),
    gray: vi.fn((text) => `[GRAY]${text}[/GRAY]`),
    green: vi.fn((text) => `[GREEN]${text}[/GREEN]`),
    blue: vi.fn((text) => `[BLUE]${text}[/BLUE]`),
  },
}));

describe('createLogger', () => {
  let mockWinstonLogger: winston.Logger;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWinstonLogger = {
      log: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    vi.mocked(winston.createLogger).mockReturnValue(mockWinstonLogger);
  });

  it('should create logger with console transport only when no logFile specified', () => {
    const _logger = createLogger();

    expect(winston.createLogger).toHaveBeenCalledWith({
      level: 'info',
      format: expect.any(Array),
      transports: expect.arrayContaining([expect.objectContaining({ type: 'console' })]),
    });

    expect(winston.transports.File).not.toHaveBeenCalled();
  });

  it('should create logger with both console and file transports when logFile specified', () => {
    const _logger = createLogger('/tmp/test.log', 'debug');

    expect(winston.createLogger).toHaveBeenCalledWith({
      level: 'debug',
      format: expect.any(Array),
      transports: expect.arrayContaining([
        expect.objectContaining({ type: 'console' }),
        expect.objectContaining({ type: 'file' }),
      ]),
    });

    expect(winston.transports.File).toHaveBeenCalledWith({
      filename: '/tmp/test.log',
      format: expect.any(Array),
    });
  });

  it('should use custom log level when specified', () => {
    const _logger = createLogger(undefined, 'warn');

    expect(winston.createLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
      })
    );
  });

  it('should return a TargetLogger instance', () => {
    const logger = createLogger();

    expect(logger).toBeInstanceOf(TargetLogger);
  });
});

describe('TargetLogger', () => {
  let mockWinstonLogger: winston.Logger;
  let targetLogger: TargetLogger;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWinstonLogger = {
      log: vi.fn(),
    };

    targetLogger = new TargetLogger(mockWinstonLogger, 'test-target');
  });

  it('should log info messages with target name', () => {
    targetLogger.info('Test info message', { extra: 'data' });

    expect(mockWinstonLogger.log).toHaveBeenCalledWith({
      level: 'info',
      message: 'Test info message',
      target: 'test-target',
      extra: 'data',
    });
  });

  it('should log error messages with target name', () => {
    targetLogger.error('Test error message');

    expect(mockWinstonLogger.log).toHaveBeenCalledWith({
      level: 'error',
      message: 'Test error message',
      target: 'test-target',
    });
  });

  it('should log warn messages with target name', () => {
    targetLogger.warn('Test warning');

    expect(mockWinstonLogger.log).toHaveBeenCalledWith({
      level: 'warn',
      message: 'Test warning',
      target: 'test-target',
    });
  });

  it('should log debug messages with target name', () => {
    targetLogger.debug('Debug info');

    expect(mockWinstonLogger.log).toHaveBeenCalledWith({
      level: 'debug',
      message: 'Debug info',
      target: 'test-target',
    });
  });

  it('should log success messages as info with checkmark', () => {
    targetLogger.success('Build completed');

    expect(mockWinstonLogger.log).toHaveBeenCalledWith({
      level: 'info',
      message: '✅ Build completed',
      target: 'test-target',
    });
  });

  it('should work without target name', () => {
    const loggerWithoutTarget = new TargetLogger(mockWinstonLogger);
    loggerWithoutTarget.info('No target');

    expect(mockWinstonLogger.log).toHaveBeenCalledWith({
      level: 'info',
      message: 'No target',
      target: undefined,
    });
  });
});

describe('SimpleLogger', () => {
  let consoleLogSpy: MockedFunction<typeof console.log>;
  let consoleErrorSpy: MockedFunction<typeof console.error>;
  let consoleWarnSpy: MockedFunction<typeof console.warn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('log level filtering', () => {
    it('should only log messages at or above configured level', () => {
      const logger = new SimpleLogger('test', 'warn');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('DEBUG'));
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('INFO'));
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('WARN'));
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR'));
    });

    it('should log all levels when set to debug', () => {
      const logger = new SimpleLogger('test', 'debug');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('INFO'));
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('should format messages with ghost emoji and timestamp', () => {
      const logger = new SimpleLogger();
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/👻 \[\d{2}:\d{2}:\d{2}\] INFO: Test message/)
      );
    });

    it('should include target name when specified', () => {
      const logger = new SimpleLogger('my-target');
      logger.info('Test message');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/👻 \[\d{2}:\d{2}:\d{2}\] INFO: \[my-target\] Test message/)
      );
    });

    it('should apply color formatting with chalk', () => {
      const logger = new SimpleLogger('test', 'debug'); // Set to debug to ensure all levels are logged

      logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[RED]'));

      logger.warn('Warning');
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('[YELLOW]'));

      logger.debug('Debug');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[GRAY]'));

      logger.success('Success');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[GREEN]'));
    });
  });

  describe('metadata handling', () => {
    it('should log metadata when provided', () => {
      const logger = new SimpleLogger();
      const metadata = { userId: 123, action: 'build' };

      logger.info('User action', metadata);

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(2, metadata);
    });

    it('should not log metadata when not provided', () => {
      const logger = new SimpleLogger();

      logger.info('No metadata');

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createTargetLogger', () => {
  it('should create a TargetLogger with specified target name', () => {
    const mockBaseLogger = {
      log: vi.fn(),
    } as winston.Logger;

    const targetLogger = createTargetLogger(mockBaseLogger, 'my-target');

    expect(targetLogger).toBeInstanceOf(TargetLogger);
    targetLogger.info('Test');

    expect(mockBaseLogger.log).toHaveBeenCalledWith({
      level: 'info',
      message: 'Test',
      target: 'my-target',
    });
  });
});

describe('createConsoleLogger', () => {
  let consoleLogSpy: MockedFunction<typeof console.log>;
  let consoleErrorSpy: MockedFunction<typeof console.error>;
  let consoleWarnSpy: MockedFunction<typeof console.warn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should create a simple console logger with all methods', () => {
    const logger = createConsoleLogger();

    expect(logger).toHaveProperty('info');
    expect(logger).toHaveProperty('error');
    expect(logger).toHaveProperty('warn');
    expect(logger).toHaveProperty('success');
  });

  it('should format messages with ghost emoji and colored prefix', () => {
    const logger = createConsoleLogger();

    logger.info('Info message');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('👻'));
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CYAN][Poltergeist][/CYAN]')
    );

    logger.error('Error message');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RED][Poltergeist][/RED]')
    );

    logger.warn('Warning');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[YELLOW][Poltergeist][/YELLOW]')
    );

    logger.success('Success');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GREEN][Poltergeist][/GREEN]')
    );
  });
});

describe('Custom Format Function', () => {
  it('should format log messages correctly', async () => {
    // We need to import the module to trigger the format.printf call
    vi.resetModules();
    await import('../src/logger.js');

    // Get the custom format function
    const formatCall = vi.mocked(winston.format.printf).mock.calls[0];
    if (!formatCall || !formatCall[0]) {
      throw new Error('printf not called');
    }
    const formatFn = formatCall[0];

    // Test different log levels
    const infoResult = formatFn({
      level: 'info',
      message: 'Test message',
      timestamp: '12:34:56',
      target: 'my-target',
    });

    expect(infoResult).toContain('👻');
    expect(infoResult).toContain('12:34:56');
    expect(infoResult).toContain('[CYAN]INFO[/CYAN]');
    expect(infoResult).toContain('[BLUE][my-target][/BLUE]');
    expect(infoResult).toContain('Test message');

    // Test error level
    const errorResult = formatFn({
      level: 'error',
      message: 'Error occurred',
      timestamp: '12:34:56',
    });

    expect(errorResult).toContain('[RED]ERROR[/RED]');
    expect(errorResult).not.toContain('[BLUE]'); // No target

    // Test with metadata
    const withMetadata = formatFn({
      level: 'debug',
      message: 'Debug info',
      timestamp: '12:34:56',
      extra: 'data',
      count: 42,
    });

    expect(withMetadata).toContain('[GRAY]DEBUG[/GRAY]');
    expect(withMetadata).toContain('[GRAY]{"extra":"data","count":42}[/GRAY]');
  });

  it('should handle special log levels', async () => {
    // We need to import the module to trigger the format.printf call
    vi.resetModules();
    await import('../src/logger.js');

    const formatCall = vi.mocked(winston.format.printf).mock.calls[0];
    if (!formatCall || !formatCall[0]) {
      throw new Error('printf not called');
    }
    const formatFn = formatCall[0];

    // Test unknown level (defaults to green)
    const customResult = formatFn({
      level: 'custom',
      message: 'Custom level',
      timestamp: '12:34:56',
    });

    expect(customResult).toContain('[GREEN]CUSTOM[/GREEN]');
  });
});
