// Logger implementation using LogTape for zero-dependency compilation
// Falls back to SimpleLogger if LogTape is not available

import chalk from 'chalk';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Try to import LogTape statically with optional dependency pattern
let logtape: any = null;
try {
  // Static import that bundler can analyze
  logtape = require('@logtape/logtape');
} catch {
  // LogTape not available - will use SimpleLogger
  // This is expected in Bun compiled binaries where optional deps might not be bundled
}

export interface Logger {
  info(message: string, metadata?: unknown): void;
  error(message: string, metadata?: unknown): void;
  warn(message: string, metadata?: unknown): void;
  debug(message: string, metadata?: unknown): void;
  success(message: string, metadata?: unknown): void;
}

// LogTape-based logger implementation
class LogTapeLogger implements Logger {
  private logger: any;
  private targetName?: string;

  constructor(logger: any, targetName?: string) {
    this.logger = logger;
    this.targetName = targetName;
  }

  private formatMessage(message: string): string {
    const ghost = '👻';
    const target = this.targetName ? `${chalk.blue(`[${this.targetName}]`)} ` : '';
    return `${ghost} ${target}${message}`;
  }

  info(message: string, metadata?: unknown): void {
    this.logger.info(this.formatMessage(message), { target: this.targetName, metadata });
  }

  error(message: string, metadata?: unknown): void {
    this.logger.error(this.formatMessage(message), { target: this.targetName, metadata });
  }

  warn(message: string, metadata?: unknown): void {
    this.logger.warn(this.formatMessage(message), { target: this.targetName, metadata });
  }

  debug(message: string, metadata?: unknown): void {
    this.logger.debug(this.formatMessage(message), { target: this.targetName, metadata });
  }

  success(message: string, metadata?: unknown): void {
    this.logger.info(this.formatMessage(`✅ ${message}`), { target: this.targetName, metadata });
  }
}

// Simple logger implementation without external dependencies
export class SimpleLogger implements Logger {
  private targetName?: string;
  private logLevel: string;
  private logStream?: any;

  constructor(targetName?: string, logLevel: string = 'info', logFile?: string) {
    this.targetName = targetName;
    this.logLevel = logLevel;

    if (logFile) {
      try {
        const dir = dirname(logFile);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        // Clear the log file for this target (one build = one log)
        this.logStream = createWriteStream(logFile, { flags: 'w' });
      } catch {
        // Ignore file logging errors
      }
    }
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

  private writeToFile(level: string, message: string): void {
    if (this.logStream) {
      const timestamp = new Date().toISOString();
      const levelStr = level.toUpperCase().padEnd(5);
      const target = this.targetName ? `[${this.targetName}] ` : '';
      // Simple plain text format: timestamp level: [target] message
      this.logStream.write(`${timestamp} ${levelStr}: ${target}${message}\n`);
    }
  }

  // Method to flush the stream (useful for tests)
  public flush(): void {
    if (this.logStream && typeof this.logStream.end === 'function') {
      this.logStream.end();
    }
  }

  info(message: string, metadata?: unknown): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('info', message);
      console.log(formatted);
      if (metadata) console.log(metadata);
      this.writeToFile('info', message);
    }
  }

  error(message: string, metadata?: unknown): void {
    if (this.shouldLog('error')) {
      const formatted = this.formatMessage('error', message);
      console.error(chalk.red(formatted));
      if (metadata) console.error(metadata);
      this.writeToFile('error', message);
    }
  }

  warn(message: string, metadata?: unknown): void {
    if (this.shouldLog('warn')) {
      const formatted = this.formatMessage('warn', message);
      console.warn(chalk.yellow(formatted));
      if (metadata) console.warn(metadata);
      this.writeToFile('warn', message);
    }
  }

  debug(message: string, metadata?: unknown): void {
    if (this.shouldLog('debug')) {
      const formatted = this.formatMessage('debug', message);
      console.log(chalk.gray(formatted));
      if (metadata) console.log(metadata);
      this.writeToFile('debug', message);
    }
  }

  success(message: string, metadata?: unknown): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage('info', `✅ ${message}`);
      console.log(chalk.green(formatted));
      if (metadata) console.log(metadata);
      this.writeToFile('info', `✅ ${message}`);
    }
  }
}

// Main logger factory
export function createLogger(logFile?: string, logLevel?: string, targetName?: string): Logger {
  const level = logLevel || 'info';

  // Try to use LogTape if available
  if (logtape) {
    try {
      const { configure, getLogger, getConsoleSink, getFileSink } = logtape;

      // Configure LogTape
      const sinks: any = {
        console: getConsoleSink({
          formatter: (record: any) => {
            const ghost = '👻';
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            const level = record.level.toUpperCase().padEnd(5);
            const category = record.category.join('/');
            return `${ghost} [${time}] ${level} [${category}] ${record.message.join('')}`;
          },
        }),
      };

      if (logFile) {
        const dir = dirname(logFile);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        sinks.file = getFileSink(logFile, {
          // Use plain text format instead of JSON
          formatter: (record: any) => {
            const timestamp = new Date().toISOString();
            const levelStr = record.level.toUpperCase().padEnd(5);
            const message = record.message.join('');
            return `${timestamp} ${levelStr}: ${message}`;
          },
        });
      }

      configure({
        sinks,
        filters: {},
        loggers: [
          {
            category: ['poltergeist'],
            level: level as any,
            sinks: logFile ? ['console', 'file'] : ['console'],
          },
        ],
        reset: true, // Allow reconfiguration for tests
      });

      const logger = getLogger(['poltergeist']);
      return new LogTapeLogger(logger, targetName);
    } catch {
      // Fall back to SimpleLogger if LogTape configuration fails
    }
  }

  // Fall back to SimpleLogger
  return new SimpleLogger(targetName, level, logFile);
}

// Target-aware logger wrapper
export class TargetLogger implements Logger {
  private logger: Logger;
  private targetName?: string;

  constructor(logger: Logger, targetName?: string) {
    this.logger = logger;
    this.targetName = targetName;
  }

  private formatMessage(message: string): string {
    const target = this.targetName ? `[${this.targetName}] ` : '';
    return `${target}${message}`;
  }

  info(message: string, metadata?: unknown): void {
    this.logger.info(this.formatMessage(message), metadata);
  }

  error(message: string, metadata?: unknown): void {
    this.logger.error(this.formatMessage(message), metadata);
  }

  warn(message: string, metadata?: unknown): void {
    this.logger.warn(this.formatMessage(message), metadata);
  }

  debug(message: string, metadata?: unknown): void {
    this.logger.debug(this.formatMessage(message), metadata);
  }

  success(message: string, metadata?: unknown): void {
    this.logger.success(this.formatMessage(message), metadata);
  }
}

// Create a logger for a specific target
export function createTargetLogger(baseLogger: Logger, targetName: string): Logger {
  return new TargetLogger(baseLogger, targetName);
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
