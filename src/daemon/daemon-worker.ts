#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { createPoltergeist } from '../factories.js';
import type { PoltergeistConfig } from '../types.js';

interface DaemonArgs {
  config: PoltergeistConfig;
  projectRoot: string;
  configPath?: string;
  target?: string;
  verbose?: boolean;
  logLevel?: string;
  logFile: string;
}

/**
 * Custom logger that writes to file instead of console
 */
class DaemonLogger {
  private logFile: string;
  private level: string;

  constructor(logFile: string, level: string) {
    this.logFile = logFile;
    this.level = level;
  }

  private async log(level: string, message: string, ...args: unknown[]): Promise<void> {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}\n`;

    try {
      await appendFile(this.logFile, formattedMessage);
    } catch (error) {
      // If log file doesn't exist, create it
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await mkdir(dirname(this.logFile), { recursive: true });
        await writeFile(this.logFile, formattedMessage);
      }
    }
  }

  async info(message: string, ...args: unknown[]): Promise<void> {
    await this.log('INFO', message, ...args);
  }

  async error(message: string, ...args: unknown[]): Promise<void> {
    await this.log('ERROR', message, ...args);
  }

  async warn(message: string, ...args: unknown[]): Promise<void> {
    await this.log('WARN', message, ...args);
  }

  async debug(message: string, ...args: unknown[]): Promise<void> {
    if (this.level === 'debug') {
      await this.log('DEBUG', message, ...args);
    }
  }
}

/**
 * Main daemon worker function
 */
export async function runDaemon(args: DaemonArgs): Promise<void> {
  const { config, projectRoot, configPath, target, verbose, logLevel, logFile } = args;

  // Create file-based logger
  // Priority: logLevel flag > verbose flag > config > default
  const effectiveLogLevel = logLevel || (verbose ? 'debug' : config.logging?.level || 'info');
  const logger = new DaemonLogger(logFile, effectiveLogLevel);

  try {
    await logger.info('Daemon starting', { projectRoot, target });

    // Create logger adapter that matches the Logger interface
    const loggerAdapter = {
      info: (message: string, metadata?: unknown) => logger.info(message, metadata),
      error: (message: string, metadata?: unknown) => logger.error(message, metadata),
      warn: (message: string, metadata?: unknown) => logger.warn(message, metadata),
      debug: (message: string, metadata?: unknown) => logger.debug(message, metadata),
      success: (message: string, metadata?: unknown) => logger.info(`✅ ${message}`, metadata),
    };

    // Create Poltergeist instance with file logger
    const poltergeist = createPoltergeist(config, projectRoot, loggerAdapter, configPath);

    // Handle shutdown signals
    const shutdown = async (signal: string) => {
      await logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await poltergeist.stop();
        await logger.info('Daemon stopped successfully');
        process.exit(0);
      } catch (error) {
        await logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Start Poltergeist
    await logger.info('Starting Poltergeist...');
    await poltergeist.start(target);
    await logger.info('Daemon started successfully');

    // Send confirmation to parent process
    await logger.debug(`process.send available: ${typeof process.send}`);
    if (process.send) {
      await logger.debug('Sending started message to parent process');
      // Send message synchronously and handle callback
      process.send({ type: 'started', pid: process.pid }, (error: Error | null) => {
        if (error) {
          logger.error('Failed to send IPC message:', error);
        } else {
          logger.debug('Started message sent successfully');
        }
      });
    } else {
      await logger.warn('No IPC channel available (process.send is undefined)');
    }

    // Keep the process alive
    // The event loop will keep running due to Watchman subscriptions
    // and the heartbeat interval
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    await logger.error('Daemon startup failed:', errorMessage);
    if (errorStack) {
      await logger.error('Stack trace:', errorStack);
    }

    // Notify parent process of failure
    if (process.send) {
      process.send({ type: 'error', error: errorMessage });
    }

    process.exit(1);
  }
}

// Only run directly if this is the main module (not imported)
// This prevents the code from running when imported by CLI
// For Bun compiled binaries, we need to explicitly check for daemon mode flags
if (
  // Check if we're running as daemon-worker.js directly
  process.argv[1]?.endsWith('daemon-worker.js') ||
  // Or if we have the --daemon-worker flag (for compiled binaries)
  process.argv.includes('--daemon-worker')
) {
  // Parse arguments and run daemon
  if (process.argv.length < 3 && !process.argv.includes('--daemon-worker')) {
    console.error('Daemon worker requires arguments');
    process.exit(1);
  }

  // Find the args - either after --daemon-worker or as argv[2]
  const argsIndex = process.argv.indexOf('--daemon-worker');
  let argsString: string | undefined;

  if (argsIndex !== -1 && process.argv[argsIndex + 1]) {
    argsString = process.argv[argsIndex + 1];
  } else if (process.argv[2]) {
    argsString = process.argv[2];
  }

  if (!argsString) {
    console.error('Daemon worker requires arguments');
    process.exit(1);
  }

  try {
    const args: DaemonArgs = JSON.parse(argsString);
    runDaemon(args).catch((error) => {
      console.error('Daemon worker error:', error);
      process.exit(1);
    });
  } catch (error) {
    console.error('Failed to parse daemon arguments:', error);
    process.exit(1);
  }
}
