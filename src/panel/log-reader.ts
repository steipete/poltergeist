import { promises as fs } from 'fs';
import { FileSystemUtils } from '../utils/filesystem.js';

export interface LogReaderOptions {
  maxBytes?: number;
  maxLines?: number;
}

export class LogTailReader {
  private readonly maxBytes: number;
  private readonly maxLines: number;

  constructor(
    private readonly projectRoot: string,
    options: LogReaderOptions = {}
  ) {
    this.maxBytes = options.maxBytes ?? 16 * 1024;
    this.maxLines = options.maxLines ?? 50;
  }

  public async read(targetName: string, channel?: string, limit?: number): Promise<string[]> {
    const logPath = FileSystemUtils.getLogFilePath(this.projectRoot, targetName, channel);
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
