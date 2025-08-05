// Enhanced logger with target-specific logging support
// Testing Poltergeist self-monitoring capabilities

import chalk from 'chalk';
import { createWriteStream } from 'fs';
import type { Logger as PinoLogger } from 'pino';
import { pino } from 'pino';

export interface Logger {
  info(message: string, metadata?: unknown): void;
  error(message: string, metadata?: unknown): void;
  warn(message: string, metadata?: unknown): void;
  debug(message: string, metadata?: unknown): void;
  success(message: string, metadata?: unknown): void;
}

// Create a custom prettifier for console output
function createPrettyTransport() {
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
      messageFormat: '{msg}',
      customPrettifiers: {
        // Note: These are string representations that will be eval'd in the worker
        // They can't reference external variables like chalk
      },
    },
  };
}

export function createLogger(logFile?: string, logLevel?: string): Logger {
  // Configure Pino with pretty printing for console
  const level = logLevel || 'info';

  let pinoLogger: PinoLogger;

  if (logFile) {
    // Create multi-stream transport for both console and file
    const streams = [
      { stream: pino.transport(createPrettyTransport()) },
      { stream: createWriteStream(logFile, { flags: 'a' }) },
    ];

    pinoLogger = pino(
      {
        level,
        formatters: {
          level: (label) => ({ level: label }),
        },
      },
      pino.multistream(streams)
    );
  } else {
    // Console only with pretty printing
    pinoLogger = pino({
      level,
      transport: createPrettyTransport(),
    });
  }

  // Return a wrapper that implements Logger interface
  return new TargetLogger(pinoLogger);
}

// Target-aware logger wrapper
export class TargetLogger implements Logger {
  private logger: PinoLogger;
  private targetName?: string;

  constructor(logger: PinoLogger, targetName?: string) {
    this.logger = logger;
    this.targetName = targetName;
  }

  private formatMetadata(metadata?: unknown): Record<string, any> {
    const base: Record<string, any> = {};

    if (this.targetName) {
      base.target = this.targetName;
    }

    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      Object.assign(base, metadata);
    } else if (metadata !== undefined) {
      base.metadata = metadata;
    }

    return base;
  }

  private formatMessage(message: string): string {
    const ghost = '👻';
    const target = this.targetName ? `${chalk.blue(`[${this.targetName}]`)} ` : '';
    return `${ghost} ${target}${message}`;
  }

  info(message: string, metadata?: unknown): void {
    this.logger.info(this.formatMetadata(metadata), this.formatMessage(message));
  }

  error(message: string, metadata?: unknown): void {
    this.logger.error(this.formatMetadata(metadata), this.formatMessage(message));
  }

  warn(message: string, metadata?: unknown): void {
    this.logger.warn(this.formatMetadata(metadata), this.formatMessage(message));
  }

  debug(message: string, metadata?: unknown): void {
    this.logger.debug(this.formatMetadata(metadata), this.formatMessage(message));
  }

  success(message: string, metadata?: unknown): void {
    // Map success to info level with special formatting
    this.logger.info(this.formatMetadata(metadata), this.formatMessage(`✅ ${message}`));
  }
}

// Create a logger for a specific target
export function createTargetLogger(baseLogger: PinoLogger, targetName: string): Logger {
  return new TargetLogger(baseLogger, targetName);
}

// Simple logger implementation without external dependencies
export class SimpleLogger implements Logger {
  private targetName?: string;
  private logLevel: string;

  constructor(targetName?: string, logLevel: string = 'info') {
    this.targetName = targetName;
    this.logLevel = logLevel;
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  private formatMessage(level: string, message: string): string {
    const ghost = '👻';
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    const target = this.targetName ? ` [${this.targetName}]` : '';
    return `${ghost} [${time}] ${level.toUpperCase()}:${target} ${message}`;
  }

  info(message: string, metadata?: unknown): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message));
      if (metadata) console.log(metadata);
    }
  }

  error(message: string, metadata?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red(this.formatMessage('error', message)));
      if (metadata) console.error(metadata);
    }
  }

  warn(message: string, metadata?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow(this.formatMessage('warn', message)));
      if (metadata) console.warn(metadata);
    }
  }

  debug(message: string, metadata?: unknown): void {
    if (this.shouldLog('debug')) {
      console.log(chalk.gray(this.formatMessage('debug', message)));
      if (metadata) console.log(metadata);
    }
  }

  success(message: string, metadata?: unknown): void {
    if (this.shouldLog('info')) {
      console.log(chalk.green(this.formatMessage('info', `✅ ${message}`)));
      if (metadata) console.log(metadata);
    }
  }
}

// Helper to create a simple console logger for CLI output
export function createConsoleLogger(): {
  info: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  success: (message: string) => void;
} {
  const ghost = '👻';

  return {
    info: (message: string) => console.log(`${ghost} ${chalk.cyan('[Poltergeist]')} ${message}`),
    error: (message: string) => console.error(`${ghost} ${chalk.red('[Poltergeist]')} ${message}`),
    warn: (message: string) => console.warn(`${ghost} ${chalk.yellow('[Poltergeist]')} ${message}`),
    success: (message: string) =>
      console.log(`${ghost} ${chalk.green('[Poltergeist]')} ${message}`),
  };
}
