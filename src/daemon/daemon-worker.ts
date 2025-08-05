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

  private async log(level: string, message: string, ...args: any[]): Promise<void> {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}\n`;

    try {
      await appendFile(this.logFile, formattedMessage);
    } catch (error) {
      // If log file doesn't exist, create it
      if ((error as any).code === 'ENOENT') {
        await mkdir(dirname(this.logFile), { recursive: true });
        await writeFile(this.logFile, formattedMessage);
      }
    }
  }

  async info(message: string, ...args: any[]): Promise<void> {
    await this.log('INFO', message, ...args);
  }

  async error(message: string, ...args: any[]): Promise<void> {
    await this.log('ERROR', message, ...args);
  }

  async warn(message: string, ...args: any[]): Promise<void> {
    await this.log('WARN', message, ...args);
  }

  async debug(message: string, ...args: any[]): Promise<void> {
    if (this.level === 'debug') {
      await this.log('DEBUG', message, ...args);
    }
  }
}

/**
 * Main daemon worker function
 */
async function runDaemon(args: DaemonArgs): Promise<void> {
  const { config, projectRoot, configPath, target, verbose, logFile } = args;

  // Create file-based logger
  const logger = new DaemonLogger(logFile, verbose ? 'debug' : config.logging?.level || 'info');

  try {
    await logger.info('Daemon starting', { projectRoot, target });

    // Create Poltergeist instance with file logger
    const poltergeist = createPoltergeist(config, projectRoot, logger as any, configPath);

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
    await poltergeist.start(target);
    await logger.info('Daemon started successfully');

    // Send confirmation to parent process
    if (process.send) {
      process.send({ type: 'started', pid: process.pid });
    }

    // Keep the process alive
    // The event loop will keep running due to Watchman subscriptions
    // and the heartbeat interval
  } catch (error) {
    await logger.error('Daemon startup failed:', error);

    // Notify parent process of failure
    if (process.send) {
      process.send({ type: 'error', error: (error as Error).message });
    }

    process.exit(1);
  }
}

// Parse arguments and run daemon
if (process.argv.length < 3) {
  console.error('Daemon worker requires arguments');
  process.exit(1);
}

try {
  const args: DaemonArgs = JSON.parse(process.argv[2]);
  runDaemon(args).catch((error) => {
    console.error('Daemon worker error:', error);
    process.exit(1);
  });
} catch (error) {
  console.error('Failed to parse daemon arguments:', error);
  process.exit(1);
}
