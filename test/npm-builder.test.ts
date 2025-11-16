import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NPMBuilder } from '../src/builders/npm-builder.js';
import type { Logger } from '../src/logger.js';
import type { StateManager } from '../src/state.js';
import type { NPMTarget } from '../src/types.js';

const existsSyncMock = vi.fn<(path: string) => boolean>();
const execSyncMock = vi.fn();
const spawnMock = vi.fn();
const stdoutEmitterFactory = () => {
  const { EventEmitter } = require('events') as typeof import('events');
  const emitter = new EventEmitter();
  emitter.setEncoding = vi.fn();
  return emitter;
};

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: [string]) => existsSyncMock(...args),
  };
});

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

const stateManager = {} as StateManager;

const projectRoot = '/project';

const makeTarget = (overrides: Partial<NPMTarget>): NPMTarget => ({
  name: 'web',
  type: 'npm',
  watchPaths: ['src/**/*'],
  ...overrides,
});

describe('NPMBuilder output paths', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    execSyncMock.mockReset();
    spawnMock.mockReset();
    execSyncMock.mockReturnValue('9.0.0');
  });

  it('allows npm targets without outputPaths during validation', async () => {
    existsSyncMock.mockImplementation((path) => path.endsWith('package.json'));

    const builder = new NPMBuilder(makeTarget({}), projectRoot, logger, stateManager);

    await expect(builder.validate()).resolves.not.toThrow();
    expect(execSyncMock).toHaveBeenCalledWith('npm --version', { stdio: 'ignore' });
  });

  it('skips post-build output verification when outputPaths are absent', async () => {
    existsSyncMock.mockImplementation((path) => path.endsWith('package.json'));

    const builder = new NPMBuilder(makeTarget({}), projectRoot, logger, stateManager);
    existsSyncMock.mockClear();

    await expect((builder as any).postBuild()).resolves.not.toThrow();
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it('still verifies declared outputPaths after a build', async () => {
    existsSyncMock.mockImplementation(
      (path) => path.endsWith('package.json') || path.endsWith('dist/index.js')
    );

    const builder = new NPMBuilder(
      makeTarget({ outputPaths: ['dist/index.js'] }),
      projectRoot,
      logger,
      stateManager
    );
    existsSyncMock.mockClear();

    await expect((builder as any).postBuild()).resolves.not.toThrow();
    expect(existsSyncMock).toHaveBeenCalledWith(`${projectRoot}/dist/index.js`);
  });

  it('streams npm build output to the log file when captureLogs is enabled', async () => {
    existsSyncMock.mockImplementation(
      (path) => path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml')
    );

    const builder = new NPMBuilder(
      makeTarget({ buildScript: 'build' }),
      projectRoot,
      logger,
      stateManager
    );

    const stdout = stdoutEmitterFactory();
    const stderr = stdoutEmitterFactory();
    spawnMock.mockImplementation(() => {
      const { EventEmitter } = require('events') as typeof import('events');
      const proc = new EventEmitter() as any;
      proc.stdout = stdout;
      proc.stderr = stderr;
      proc.kill = vi.fn();
      // Emit output and exit on next tick
      setImmediate(() => {
        stdout.emit('data', Buffer.from('out line\n'));
        stderr.emit('data', Buffer.from('err line\n'));
        proc.emit('close', 0);
        proc.emit('exit', 0);
      });
      return proc;
    });

    const logFile = `${process.env.TMPDIR ?? '/tmp'}/poltergeist-npm-builder.log`;
    await (builder as any).executeBuild({ captureLogs: true, logFile });

    expect(spawnMock).toHaveBeenCalledWith('pnpm run build', {
      cwd: projectRoot,
      env: expect.any(Object),
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    await new Promise((r) => setTimeout(r, 0));
    const written = require('fs').readFileSync(logFile, 'utf-8');
    expect(written).toContain('out line');
    expect(written).toContain('err line');
  });
});
