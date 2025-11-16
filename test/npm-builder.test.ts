import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NPMBuilder } from '../src/builders/npm-builder.js';
import type { Logger } from '../src/logger.js';
import type { StateManager } from '../src/state.js';
import type { NPMTarget } from '../src/types.js';

const existsSyncMock = vi.fn<(path: string) => boolean>();
const execSyncMock = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: [string]) => existsSyncMock(...args),
}));

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
};

const stateManager = {} as unknown as StateManager;

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
});
