import type { WriteStream } from 'tty';

export interface TerminalStreams {
  stdout?: WriteStream | null;
  stderr?: WriteStream | null;
}

export function envFlagEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  return normalized !== '0' && normalized !== 'false' && normalized !== 'no';
}

export function hasPositiveDimension(value: number | undefined): boolean {
  if (typeof value === 'number') {
    return value > 0;
  }
  return true;
}

/**
 * Determine whether the current terminal supports rich output (spinners, colors, sizing).
 * Streams and environment can be injected to simplify testing.
 */
export function hasRichTTY(
  streams: TerminalStreams = {
    stdout: process.stdout as WriteStream,
    stderr: process.stderr as WriteStream,
  },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (envFlagEnabled(env.POLTER_FORCE_TTY)) {
    return true;
  }

  if (envFlagEnabled(env.POLTER_DISABLE_TTY)) {
    return false;
  }

  const stdout = streams.stdout;
  const stderr = streams.stderr;

  if (!stdout?.isTTY || !stderr?.isTTY) {
    return false;
  }

  if (envFlagEnabled(env.CI)) {
    return false;
  }

  const term = env.TERM?.toLowerCase();
  if (!term || term === 'dumb') {
    return false;
  }

  const stdoutStream = stdout as WriteStream;

  if (!hasPositiveDimension(stdoutStream.columns) || !hasPositiveDimension(stdoutStream.rows)) {
    return false;
  }

  if (typeof stdoutStream.getColorDepth === 'function' && stdoutStream.getColorDepth() <= 1) {
    return false;
  }

  return true;
}
