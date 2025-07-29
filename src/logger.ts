import winston from 'winston';
import chalk from 'chalk';

const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  const ghost = '👻';
  const coloredLevel = level === 'error' ? chalk.red(level.toUpperCase()) :
                      level === 'warn' ? chalk.yellow(level.toUpperCase()) :
                      level === 'info' ? chalk.green(level.toUpperCase()) :
                      chalk.gray(level.toUpperCase());

  let output = `${ghost} [${timestamp}] ${coloredLevel}: ${message}`;
  
  if (Object.keys(metadata).length > 0) {
    output += ` ${JSON.stringify(metadata)}`;
  }
  
  return output;
});

export function createLogger(logFile: string, logLevel: string): winston.Logger {
  return winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
    ),
    transports: [
      // Console transport with colors
      new winston.transports.Console({
        format: winston.format.combine(
          customFormat
        ),
      }),
      // File transport without colors
      new winston.transports.File({
        filename: logFile,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }),
    ],
  });
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