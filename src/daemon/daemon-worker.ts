#!/usr/bin/env node

import { createPoltergeist } from '../factories.js';
import { createLogger } from '../logger.js';
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
 * Main daemon worker function
 */
export async function runDaemon(args: DaemonArgs): Promise<void> {
  const { config, projectRoot, configPath, target, verbose, logLevel, logFile } = args;

  // Create file-based logger using the standard logger factory
  // Priority: logLevel flag > verbose flag > config > default
  const effectiveLogLevel = logLevel || (verbose ? 'debug' : config.logging?.level || 'info');
  // Pass target name if running a specific target, otherwise undefined for multi-target daemon
  const logger = createLogger(logFile, effectiveLogLevel, target);

  try {
    logger.info('Daemon starting', { projectRoot, target });

    // Create Poltergeist instance with file logger
    const poltergeist = createPoltergeist(config, projectRoot, logger, configPath);

    // Handle shutdown signals
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await poltergeist.stop();
        logger.info('Daemon stopped successfully');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Start Poltergeist
    logger.info('Starting Poltergeist...');
    await poltergeist.start(target);
    logger.info('Daemon started successfully');

    // Send confirmation to parent process
    logger.debug(`process.send available: ${typeof process.send}`);
    if (process.send) {
      logger.debug('Sending started message to parent process');
      // Send message synchronously and handle callback
      process.send({ type: 'started', pid: process.pid }, (error: Error | null) => {
        if (error) {
          logger.error('Failed to send IPC message:', error);
        } else {
          logger.debug('Started message sent successfully');
        }
      });
    } else {
      logger.warn('No IPC channel available (process.send is undefined)');
    }

    // Keep the process alive
    // The event loop will keep running due to Watchman subscriptions
    // and the heartbeat interval
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error('Daemon startup failed:', errorMessage);
    if (errorStack) {
      logger.error('Stack trace:', errorStack);
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