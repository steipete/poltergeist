// Enhanced logger with target-specific logging support
import winston from 'winston';
import chalk from 'chalk';

export interface Logger {
  info(message: string, metadata?: any): void;
  error(message: string, metadata?: any): void;
  warn(message: string, metadata?: any): void;
  debug(message: string, metadata?: any): void;
  success(message: string, metadata?: any): void;
}

// Custom format for console output with target names
const customFormat = winston.format.printf(({ level, message, timestamp, target, ...metadata }) => {
  const ghost = '👻';
  const coloredLevel = level === 'error' ? chalk.red(level.toUpperCase()) :
                      level === 'warn' ? chalk.yellow(level.toUpperCase()) :
                      level === 'info' ? chalk.cyan('INFO') :
                      level === 'debug' ? chalk.gray('DEBUG') :
                      chalk.green(level.toUpperCase());

  // Include target name if present
  const targetPrefix = target ? chalk.blue(`[${target}]`) + ' ' : '';
  
  let output = `${ghost} [${timestamp}] ${coloredLevel}: ${targetPrefix}${message}`;
  
  // Add metadata if present
  const metadataKeys = Object.keys(metadata);
  if (metadataKeys.length > 0 && metadataKeys.some(key => metadata[key] !== undefined)) {
    output += ` ${chalk.gray(JSON.stringify(metadata))}`;
  }
  
  return output;
});

export function createLogger(logFile?: string, logLevel?: string): Logger {
  const transports: winston.transport[] = [
    // Console transport with colors
    new winston.transports.Console({
      format: winston.format.combine(
        customFormat
      ),
    }),
  ];

  // Add file transport if logFile is specified
  if (logFile) {
    transports.push(
      new winston.transports.File({
        filename: logFile,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      })
    );
  }

  const winstonLogger = winston.createLogger({
    level: logLevel || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
    ),
    transports,
  });

  // Return a wrapper that implements Logger interface
  return new TargetLogger(winstonLogger);
}

// Target-aware logger wrapper
export class TargetLogger implements Logger {
  private logger: winston.Logger;
  private targetName?: string;

  constructor(logger: winston.Logger, targetName?: string) {
    this.logger = logger;
    this.targetName = targetName;
  }

  private log(level: string, message: string, metadata?: any): void {
    this.logger.log({
      level,
      message,
      target: this.targetName,
      ...metadata,
    });
  }

  info(message: string, metadata?: any): void {
    this.log('info', message, metadata);
  }

  error(message: string, metadata?: any): void {
    this.log('error', message, metadata);
  }

  warn(message: string, metadata?: any): void {
    this.log('warn', message, metadata);
  }

  debug(message: string, metadata?: any): void {
    this.log('debug', message, metadata);
  }

  success(message: string, metadata?: any): void {
    // Map success to info level with special formatting
    this.log('info', `✅ ${message}`, metadata);
  }
}

// Create a logger for a specific target
export function createTargetLogger(baseLogger: winston.Logger, targetName: string): Logger {
  return new TargetLogger(baseLogger, targetName);
}

// Simple logger implementation without winston dependency
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

  info(message: string, metadata?: any): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message));
      if (metadata) console.log(metadata);
    }
  }

  error(message: string, metadata?: any): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red(this.formatMessage('error', message)));
      if (metadata) console.error(metadata);
    }
  }

  warn(message: string, metadata?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow(this.formatMessage('warn', message)));
      if (metadata) console.warn(metadata);
    }
  }

  debug(message: string, metadata?: any): void {
    if (this.shouldLog('debug')) {
      console.log(chalk.gray(this.formatMessage('debug', message)));
      if (metadata) console.log(metadata);
    }
  }

  success(message: string, metadata?: any): void {
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
    success: (message: string) => console.log(`${ghost} ${chalk.green('[Poltergeist]')} ${message}`),
  };
}