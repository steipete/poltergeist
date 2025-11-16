import chalk from 'chalk';
import { createReadStream, readFileSync, statSync, watchFile } from 'fs';
import { createInterface } from 'readline';
import { ghost } from '../utils/ghost.js';

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  target?: string;
  [key: string]: unknown;
}

type ParsedLog = { entry?: LogEntry; error?: unknown };

export function parseLogLine(line: string, targetFilter?: string): ParsedLog {
  // New plain text format: timestamp LEVEL: [target] message
  const plainTextMatch = line.match(/^(\S+)\s+(\w+)\s*:\s*(?:\[([^\]]+)\]\s*)?(.*)$/);

  if (plainTextMatch) {
    const [, timestamp, level, target, message] = plainTextMatch;
    return {
      entry: {
        timestamp,
        level: level.toLowerCase(),
        message: message.trim(),
        target: target || targetFilter,
      },
    };
  }

  if (line.startsWith('{')) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (targetFilter && entry.target !== targetFilter) {
        return {};
      }
      return { entry };
    } catch (error) {
      return { error };
    }
  }

  return {};
}

// Display logs with formatting and filtering
export async function displayLogs(
  logFile: string,
  options: {
    target?: string;
    lines: string;
    follow?: boolean;
    json?: boolean;
  }
): Promise<void> {
  const maxLines = Number.parseInt(options.lines, 10);

  if (options.follow) {
    await followLogs(logFile, options.target, options.json);
    return;
  }

  // Read and parse log entries
  const logEntries = await readLogEntries(logFile, options.target, maxLines);

  if (logEntries.length === 0) {
    if (options.target) {
      console.log(chalk.yellow(`No logs found for target: ${options.target}`));
    } else {
      console.log(chalk.yellow('No logs found'));
    }
    return;
  }

  // Display logs
  if (options.json) {
    console.log(JSON.stringify(logEntries, null, 2));
  } else {
    console.log(chalk.cyan(`${ghost.brand()} Poltergeist Logs`));
    console.log(chalk.gray('═'.repeat(50)));
    logEntries.forEach(formatLogEntry);
  }
}

// Read and parse log entries from file
export async function readLogEntries(
  logFile: string,
  targetFilter?: string,
  maxLines?: number
): Promise<LogEntry[]> {
  const content = readFileSync(logFile, 'utf-8');
  const lines = content
    .trim()
    .split('\n')
    .filter((line) => line.trim());

  const entries: LogEntry[] = [];

  for (const line of lines) {
    const { entry } = parseLogLine(line, targetFilter);
    if (entry) {
      entries.push(entry);
    }
  }

  // Return last N lines if maxLines specified
  if (maxLines && entries.length > maxLines) {
    return entries.slice(-maxLines);
  }

  return entries;
}

// Format a single log entry for display
export function formatLogEntry(entry: LogEntry): void {
  // Handle timestamp - Pino gives us HH:mm:ss format, so use it directly
  const timestamp = entry.timestamp.includes(':')
    ? entry.timestamp
    : new Date(entry.timestamp).toLocaleString();
  const level = formatLogLevel(entry.level);
  const target = entry.target ? chalk.blue(`[${entry.target}]`) : '';
  const message = entry.message;

  console.log(`${chalk.gray(timestamp)} ${level} ${target} ${message}`);

  // Show additional metadata if present
  const metadata: Record<string, unknown> = { ...entry };
  delete metadata.timestamp;
  delete metadata.level;
  delete metadata.message;
  delete metadata.target;

  const metadataKeys = Object.keys(metadata);
  if (metadataKeys.length > 0 && metadataKeys.some((key) => metadata[key] !== undefined)) {
    console.log(chalk.gray(`  ${JSON.stringify(metadata)}`));
  }
}

// Format log level with colors
export function formatLogLevel(level: string): string {
  switch (level.toLowerCase()) {
    case 'error':
      return chalk.red('ERROR');
    case 'warn':
      return chalk.yellow('WARN ');
    case 'info':
      return chalk.cyan('INFO ');
    case 'debug':
      return chalk.gray('DEBUG');
    case 'success':
      return chalk.green('SUCCESS');
    default:
      return chalk.white(level.padEnd(5).toUpperCase());
  }
}

// Follow logs in real-time
export async function followLogs(
  logFile: string,
  targetFilter?: string,
  jsonOutput?: boolean
): Promise<void> {
  let fileSize = statSync(logFile).size;

  console.log(chalk.cyan(`${ghost.brand()} Following Poltergeist logs... (Press Ctrl+C to exit)`));
  if (targetFilter) {
    console.log(chalk.gray(`Target: ${targetFilter}`));
  }
  console.log(chalk.gray('═'.repeat(50)));

  // Display existing logs first
  const existingEntries = await readLogEntries(logFile, targetFilter, 20);
  if (jsonOutput) {
    for (const entry of existingEntries) {
      console.log(JSON.stringify(entry));
    }
  } else {
    for (const entry of existingEntries) {
      formatLogEntry(entry);
    }
  }

  // Watch for new log entries
  watchFile(logFile, { interval: 500 }, (curr) => {
    if (curr.size > fileSize) {
      const stream = createReadStream(logFile, {
        start: fileSize,
        encoding: 'utf-8',
      });

      const rl = createInterface({
        input: stream,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      rl.on('line', (line) => {
        if (!line.trim()) return;

        const { entry } = parseLogLine(line, targetFilter);
        if (!entry) return;

        if (jsonOutput) {
          console.log(JSON.stringify(entry));
        } else {
          formatLogEntry(entry);
        }
      });

      fileSize = curr.size;
    }
  });

  // Keep process alive
  return new Promise(() => {
    // This promise never resolves to keep the follow active
    // User exits with Ctrl+C
  });
}
