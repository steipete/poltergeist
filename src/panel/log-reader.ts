import { promises as fs } from 'fs';
import { resolveLogPath } from '../cli/log-path-resolver.js';
import type { PoltergeistConfig } from '../types.js';
import { FileSystemUtils } from '../utils/filesystem.js';

export interface LogReaderOptions {
  maxBytes?: number;
  maxLines?: number;
}

export class LogTailReader {
  private readonly maxBytes: number;
  private readonly maxLines: number;
  private readonly config?: PoltergeistConfig;

  constructor(
    private readonly projectRoot: string,
    options: LogReaderOptions & { config?: PoltergeistConfig } = {}
  ) {
    this.maxBytes = options.maxBytes ?? 16 * 1024;
    this.maxLines = options.maxLines ?? 50;
    this.config = options.config;
  }

  public async read(targetName: string, channel?: string, limit?: number): Promise<string[]> {
    const logPath = this.config
      ? resolveLogPath({ projectRoot: this.projectRoot, config: this.config, targetName, channel })
          .logFile
      : FileSystemUtils.getLogFilePath(this.projectRoot, targetName, channel);

    if (!logPath) return [];
    const maxLines = limit ?? this.maxLines;

    try {
      const handle = await fs.open(logPath, 'r');
      try {
        const stats = await handle.stat();
        if (stats.size === 0) {
          return [];
        }

        const readLength = Math.min(this.maxBytes, stats.size);
        const buffer = Buffer.alloc(readLength);
        await handle.read(buffer, 0, readLength, stats.size - readLength);
        const text = buffer.toString('utf-8').replace(/\0/g, '');
        const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
        return lines.slice(-maxLines);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return [];
      }
      return [];
    }
  }
}
