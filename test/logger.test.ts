// Comprehensive tests for Logger functionality

import type { Logger as PinoLogger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, type MockedFunction, vi } from 'vitest';
import {
  createConsoleLogger,
  createLogger,
  createTargetLogger,
  SimpleLogger,
  TargetLogger,
} from '../src/logger.js';

// Mock pino
vi.mock('pino', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  const pinoMock = vi.fn(() => mockLogger);
  pinoMock.multistream = vi.fn((streams) => streams);
  pinoMock.transport = vi.fn((transport) => transport);

  return {
    pino: pinoMock,
    default: pinoMock,
  };
});

// Mock pino-pretty
vi.mock('pino-pretty', () => ({
  default: vi.fn(),
}));

// Mock fs for file streams
vi.mock('fs', () => ({
  createWriteStream: vi.fn((path) => ({ path, flags: 'a' })),
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

describe.skip('createLogger', () => {
  let mockPinoLogger: PinoLogger;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPinoLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      silent: vi.fn(),
      level: 'info',
      child: vi.fn(),
      bindings: vi.fn(),
      flush: vi.fn(),
      onChild: vi.fn(),
    } as any;

    const { pino } = await import('pino');
    vi.mocked(pino).mockReturnValue(mockPinoLogger);
  });

  it('should create logger with console transport only when no logFile specified', async () => {
    const _logger = createLogger();

    const { pino } = await import('pino');
    expect(pino).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        transport: expect.objectContaining({
          target: 'pino-pretty',
        }),
      })
    );
  });

  it('should create logger with both console and file transports when logFile specified', async () => {
    const _logger = createLogger('/tmp/test.log', 'debug');

    const { pino } = await import('pino');
    const { createWriteStream } = await import('fs');

    expect(createWriteStream).toHaveBeenCalledWith('/tmp/test.log', { flags: 'a' });
    expect(pino).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
      }),
      expect.anything()
    );
  });

  it('should use custom log level when specified', async () => {
    const _logger = createLogger(undefined, 'warn');

    const { pino } = await import('pino');
    expect(pino).toHaveBeenCalledWith(
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

describe.skip('TargetLogger', () => {
  let mockPinoLogger: PinoLogger;
  let targetLogger: TargetLogger;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPinoLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any;

    targetLogger = new TargetLogger(mockPinoLogger, 'test-target');
  });

  it('should log info messages with target name', () => {
    targetLogger.info('Test info message', { extra: 'data' });

    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      {
        target: 'test-target',
        extra: 'data',
      },
      expect.stringContaining('👻')
    );
    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('[BLUE][test-target][/BLUE]')
    );
    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Test info message')
    );
  });

  it('should log error messages with target name', () => {
    targetLogger.error('Test error message');

    expect(mockPinoLogger.error).toHaveBeenCalledWith(
      {
        target: 'test-target',
      },
      expect.stringContaining('👻')
    );
    expect(mockPinoLogger.error).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Test error message')
    );
  });

  it('should log warn messages with target name', () => {
    targetLogger.warn('Test warning');

    expect(mockPinoLogger.warn).toHaveBeenCalledWith(
      {
        target: 'test-target',
      },
      expect.stringContaining('👻')
    );
    expect(mockPinoLogger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Test warning')
    );
  });

  it('should log debug messages with target name', () => {
    targetLogger.debug('Debug info');

    expect(mockPinoLogger.debug).toHaveBeenCalledWith(
      {
        target: 'test-target',
      },
      expect.stringContaining('👻')
    );
    expect(mockPinoLogger.debug).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('Debug info')
    );
  });

  it('should log success messages as info with checkmark', () => {
    targetLogger.success('Build completed');

    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      {
        target: 'test-target',
      },
      expect.stringContaining('👻')
    );
    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('✅ Build completed')
    );
  });

  it('should work without target name', () => {
    const loggerWithoutTarget = new TargetLogger(mockPinoLogger);
    loggerWithoutTarget.info('No target');

    expect(mockPinoLogger.info).toHaveBeenCalledWith({}, expect.stringContaining('👻'));
    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('No target')
    );
  });

  it('should handle non-object metadata', () => {
    targetLogger.info('Test', 'string metadata');

    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      {
        target: 'test-target',
        metadata: 'string metadata',
      },
      expect.stringContaining('Test')
    );
  });

  it('should handle array metadata', () => {
    targetLogger.info('Test', [1, 2, 3]);

    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      {
        target: 'test-target',
        metadata: [1, 2, 3],
      },
      expect.stringContaining('Test')
    );
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

describe.skip('createTargetLogger', () => {
  it('should create a TargetLogger with specified target name', () => {
    const mockBaseLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any;

    const targetLogger = createTargetLogger(mockBaseLogger, 'my-target');

    expect(targetLogger).toBeInstanceOf(TargetLogger);
    targetLogger.info('Test');

    expect(mockBaseLogger.info).toHaveBeenCalledWith(
      {
        target: 'my-target',
      },
      expect.stringContaining('Test')
    );
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
