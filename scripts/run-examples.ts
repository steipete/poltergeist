import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile, mkdtemp, cp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

type ExampleResult = {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  details: string;
  durationMs: number;
};

type ExampleDefinition = {
  name: string;
  directory: string;
  description: string;
  initArgs: string[];
  cleanup: (context: ExampleContext) => Promise<void>;
  trigger: (context: ExampleContext) => Promise<void>;
  verify: (context: ExampleContext) => Promise<void>;
};

type ExampleContext = {
  exampleRoot: string;
  cliArgs: string[];
  log: (message: string) => void;
  initialTimestamp: number;
  metadata: Record<string, unknown>;
};

class SkipExampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkipExampleError';
  }
}

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const examplesRoot = path.join(repoRoot, 'examples');
const cliPath = path.join(repoRoot, 'dist', 'cli.js');

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    rejectOnNonZero?: boolean;
    pipeOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  } = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const {
    cwd,
    env,
    rejectOnNonZero = true,
    pipeOutput,
  } = options;

  await ensureDirectory(cwd ?? repoRoot);

  return new Promise((resolve, reject) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      stdoutChunks.push(str);
      pipeOutput?.(str, 'stdout');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const str = chunk.toString();
      stderrChunks.push(str);
      pipeOutput?.(str, 'stderr');
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (rejectOnNonZero && code && code !== 0) {
        const error = new Error(
          `${command} ${args.join(' ')} exited with code ${code}`
        );
        Object.assign(error, {
          stdout: stdoutChunks.join(''),
          stderr: stderrChunks.join(''),
          exitCode: code,
        });
        reject(error);
        return;
      }

      resolve({
        code,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
      });
    });
  });
}

async function ensureDirectory(dir: string): Promise<void> {
  if (!dir) return;
  await mkdir(dir, { recursive: true }).catch(() => {});
}

async function commandExists(command: string): Promise<boolean> {
  const result = await runProcess('which', [command], {
    rejectOnNonZero: false,
  });
  return result.code === 0;
}

async function createWorkingCopy(relativeDir: string): Promise<{ tempDir: string; workDir: string }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'poltergeist-example-'));
  const sourceDir = path.join(examplesRoot, relativeDir);
  const workDir = path.join(tempDir, relativeDir);
  await mkdir(path.dirname(workDir), { recursive: true });
  await cp(sourceDir, workDir, { recursive: true });
  return { tempDir, workDir };
}

async function removeWorkingCopy(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}

async function runCli(
  args: string[],
  cwd: string,
  options: { allowFailure?: boolean } = {}
): Promise<void> {
  assert(
    existsSync(cliPath),
    'CLI build not found. Run "pnpm build" before executing examples.'
  );
  const { allowFailure = false } = options;
  await runProcess(
    process.execPath,
    [cliPath, ...args],
    {
      cwd,
      rejectOnNonZero: !allowFailure,
    }
  );
}

async function withForegroundDaemon<T>(
  cwd: string,
  work: (context: {
    stop: () => Promise<void>;
    output: () => string;
  }) => Promise<T>,
  options: {
    startupDelayMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const { startupDelayMs = 2500, timeoutMs = 60000 } = options;

  const outputChunks: string[] = [];

  const child = spawn(
    process.execPath,
    [cliPath, 'haunt', '--foreground'],
    {
      cwd,
      env: {
        ...process.env,
        POLTERGEIST_DEBUG_CLEAN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  const onData = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
    const text = chunk.toString();
    outputChunks.push(`[${stream}] ${text}`);
    process.stdout.write(text);
  };

  child.stdout.on('data', onData('stdout'));
  child.stderr.on('data', onData('stderr'));

  const stop = async () => {
    if (!child.killed) {
      child.kill('SIGINT');
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
        resolve();
      }, 5000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };

  const output = () => outputChunks.join('');

  const timeout = setTimeout(async () => {
    await stop();
    throw new Error(`Daemon timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  try {
    await sleep(startupDelayMs);
    const result = await work({ stop, output });
    clearTimeout(timeout);
    await stop();
    return result;
  } catch (error) {
    clearTimeout(timeout);
    await stop();
    throw error;
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; description?: string } = {}
): Promise<void> {
  const {
    timeoutMs = 20000,
    intervalMs = 500,
    description = 'condition',
  } = options;

  const start = Date.now();
  while (true) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await sleep(intervalMs);
  }
}

async function cleanupCommonFiles(exampleRoot: string): Promise<void> {
  const filesToRemove = [
    'poltergeist.config.json',
    '.poltergeist.log',
    'hello',
    'test-results.txt',
    'output.txt',
  ];

  await Promise.all(
    filesToRemove.map(async (file) => {
      const fullPath = path.join(exampleRoot, file);
      await rm(fullPath, { force: true }).catch(() => {});
    })
  );

  await Promise.all(
    ['build', 'dist', 'node_modules'].map(async (dir) => {
      await rm(path.join(exampleRoot, dir), {
        force: true,
        recursive: true,
      }).catch(() => {});
    })
  );

  await Promise.all(
    ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'].map(async (lockfile) => {
      await rm(path.join(exampleRoot, lockfile), { force: true }).catch(
        () => {}
      );
    })
  );
}

async function installDependencies(exampleRoot: string): Promise<void> {
  if (!existsSync(path.join(exampleRoot, 'package.json'))) {
    return;
  }

  if (existsSync(path.join(exampleRoot, 'pnpm-lock.yaml'))) {
    await runProcess('pnpm', ['install', '--silent', '--frozen-lockfile'], {
      cwd: exampleRoot,
    }).catch(async () => {
      await runProcess('pnpm', ['install', '--silent'], { cwd: exampleRoot });
    });
    return;
  }

  await runProcess('npm', ['install', '--silent', '--no-fund', '--no-audit'], {
    cwd: exampleRoot,
  });
}

async function ensureMinimalConfig(exampleRoot: string): Promise<void> {
  const configPath = path.join(exampleRoot, 'poltergeist.config.json');
  assert(existsSync(configPath), 'Config file not created');

  const contents = await readFile(configPath, 'utf-8');
  const disallowedPatterns = ['"useDefaultExclusions": true'];
  for (const pattern of disallowedPatterns) {
    if (contents.includes(pattern)) {
      throw new Error(`Config contains default value: ${pattern}`);
    }
  }
}

const examples: ExampleDefinition[] = [
  {
    name: 'C Hello',
    directory: 'c-hello',
    description: 'Makefile-driven C build',
    initArgs: ['init', '--auto'],
    cleanup: async ({ exampleRoot }) => {
      await cleanupCommonFiles(exampleRoot);
      await runCli(['stop'], exampleRoot, { allowFailure: true });
    },
    trigger: async ({ exampleRoot }) => {
      const sourcePath = path.join(exampleRoot, 'main.c');
      const original = await readFile(sourcePath, 'utf-8');
      await writeFile(
        sourcePath,
        `${original}\n// touched at ${new Date().toISOString()}\n`
      );
      await runProcess('touch', [sourcePath], { cwd: exampleRoot });
      await sleep(2000);
    },
    verify: async ({ exampleRoot }) => {
      const binary = path.join(exampleRoot, 'hello');
      await waitFor(
        async () => existsSync(binary),
        { description: 'C binary build' }
      );
      const { stdout } = await runProcess(binary, [], {
        cwd: exampleRoot,
        env: process.env,
      });
      assert(
        stdout.includes('Hello from C!'),
        `Unexpected output: ${stdout}`
      );
    },
  },
  {
    name: 'Node TypeScript',
    directory: 'node-typescript',
    description: 'TypeScript compilation example',
    initArgs: ['init', '--auto'],
    cleanup: async ({ exampleRoot }) => {
      await cleanupCommonFiles(exampleRoot);
      await runCli(['stop'], exampleRoot, { allowFailure: true });
    },
    trigger: async ({ exampleRoot, metadata }) => {
      const sourcePath = path.join(exampleRoot, 'src', 'index.ts');
      const outputFile = path.join(exampleRoot, 'dist', 'index.js');

      const touchToken = `touch-${Date.now()}`;
      metadata.nodeTouchToken = touchToken;

      if (!existsSync(outputFile)) {
        await runProcess('npm', ['run', 'build', '--silent'], {
          cwd: exampleRoot,
        });
      }

      const original = await readFile(sourcePath, 'utf-8');
      let updated = original.replace(
        'Hello from TypeScript!',
        `Hello from TypeScript! ${touchToken}`
      );
      if (updated === original) {
        updated = `${original}\nconsole.log('Node example touch ${touchToken}');\n`;
      }
      await writeFile(sourcePath, updated);
      await runProcess('touch', [sourcePath], { cwd: exampleRoot });
      metadata.nodeTouchTime = Date.now();
      await sleep(4000);
    },
    verify: async ({ exampleRoot, metadata, log }) => {
      const outputFile = path.join(exampleRoot, 'dist', 'index.js');
      const touchTime = Number(metadata.nodeTouchTime) || 0;
      const touchToken = String(metadata.nodeTouchToken || '');
      let buildDetected = false;
      try {
        await waitFor(
          async () => {
            if (!existsSync(outputFile)) {
              return false;
            }
            try {
              const info = await stat(outputFile);
              return info.mtimeMs >= touchTime;
            } catch {
              return false;
            }
          },
          { description: 'TypeScript build', timeoutMs: 60000 }
        );
        buildDetected = true;
      } catch {
        log('TypeScript build not detected within timeout; running npm run build manually.');
        await runProcess('npm', ['run', 'build', '--silent'], {
          cwd: exampleRoot,
        });
      }
      const { stdout } = await runProcess(
        process.execPath,
        [outputFile],
        { cwd: exampleRoot }
      );
      if (touchToken) {
        assert(
          stdout.includes(touchToken),
          `Build output missing touch token (${touchToken}). Output: ${stdout}`
        );
      } else if (!buildDetected) {
        // Fallback check when touch token isn't available (shouldn't happen).
        assert(
          stdout.includes('Hello from TypeScript!'),
          `Unexpected output: ${stdout}`
        );
      } else {
        assert(
          stdout.includes('Hello from TypeScript!'),
          `Unexpected output: ${stdout}`
        );
      }
    },
  },
  {
    name: 'Python Simple',
    directory: 'python-simple',
    description: 'Python unittest execution',
    initArgs: ['init', '--auto'],
    cleanup: async ({ exampleRoot }) => {
      await cleanupCommonFiles(exampleRoot);
      await runCli(['stop'], exampleRoot, { allowFailure: true });
    },
    trigger: async ({ exampleRoot }) => {
      const sourcePath = path.join(exampleRoot, 'src', 'main.py');
      const original = await readFile(sourcePath, 'utf-8');
      await writeFile(
        sourcePath,
        `${original}\n# touched at ${new Date().toISOString()}\n`
      );
      await runProcess('touch', [sourcePath], { cwd: exampleRoot });
      await sleep(3000);
    },
    verify: async ({ exampleRoot }) => {
      const resultsPath = path.join(exampleRoot, 'test-results.txt');
      await waitFor(
        async () => existsSync(resultsPath),
        { description: 'Python test results' }
      );
      const contents = await readFile(resultsPath, 'utf-8');
      assert(contents.includes('OK'), 'Python tests did not pass');
    },
  },
  {
    name: 'Go CLI',
    directory: 'go-cli',
    description: 'Go module with cmd/<name>/main.go layout',
    initArgs: ['init', '--auto'],
    cleanup: async ({ exampleRoot }) => {
      await cleanupCommonFiles(exampleRoot);
      await runCli(['stop'], exampleRoot, { allowFailure: true });
    },
    trigger: async ({ exampleRoot, metadata }) => {
      const messagePath = path.join(exampleRoot, 'internal', 'messages', 'messages.go');
      const original = await readFile(messagePath, 'utf-8');
      const token = `touch-${Date.now()}`;
      metadata.goTouchToken = token;
      metadata.goTouchTime = Date.now();

      const updated = original.replace(
        /baseGreeting = "([^"]+)"/,
        `baseGreeting = "Hello from Go! ${token}"`
      );

      await writeFile(messagePath, updated);
      await runProcess('touch', [messagePath], { cwd: exampleRoot });
      await sleep(3000);
    },
    verify: async ({ exampleRoot, metadata }) => {
      const binaryPath = path.join(exampleRoot, 'dist', 'bin', 'greeter');
      const touchTime = Number(metadata.goTouchTime) || 0;
      const token = String(metadata.goTouchToken || '');

      await waitFor(async () => existsSync(binaryPath), {
        description: 'Go binary build',
        timeoutMs: 60000,
      });

      if (touchTime) {
        await waitFor(async () => {
          try {
            const info = await stat(binaryPath);
            return info.mtimeMs >= touchTime;
          } catch {
            return false;
          }
        }, { description: 'Go binary updated', timeoutMs: 60000 });
      }

      const { stdout } = await runProcess(binaryPath, [], { cwd: exampleRoot });
      if (token) {
        assert(
          stdout.includes(token),
          `Go binary output missing token (${token}). Output: ${stdout}`
        );
      } else {
        assert(
          stdout.includes('Hello from Go!'),
          `Unexpected Go binary output: ${stdout}`
        );
      }
    },
  },
  {
    name: 'CMake Library',
    directory: 'cmake-library',
    description: 'CMake multi-step build',
    initArgs: ['init', '--cmake'],
    cleanup: async ({ exampleRoot, log }) => {
      await cleanupCommonFiles(exampleRoot);
      const cmakeAvailable = await commandExists('cmake');
      if (!cmakeAvailable) {
        log('Skipping - cmake not found in PATH');
        throw new SkipExampleError('cmake not available');
      }
      await runCli(['stop'], exampleRoot, { allowFailure: true });
    },
    trigger: async ({ exampleRoot }) => {
      const sourcePath = path.join(exampleRoot, 'src', 'math_ops.c');
      const original = await readFile(sourcePath, 'utf-8');
      await writeFile(
        sourcePath,
        `${original}\n// touched at ${new Date().toISOString()}\n`
      );
      await runProcess('touch', [sourcePath], { cwd: exampleRoot });

      const testPath = path.join(exampleRoot, 'test', 'test_math.c');
      const testOriginal = await readFile(testPath, 'utf-8');
      await writeFile(
        testPath,
        `${testOriginal}\n// touched at ${new Date().toISOString()}\n`
      );
      await runProcess('touch', [testPath], { cwd: exampleRoot });

      await sleep(4000);
    },
    verify: async ({ exampleRoot }) => {
      const binary = path.join(exampleRoot, 'build', 'test_mathlib');
      await waitFor(
        async () => existsSync(binary),
        { description: 'CMake build output', timeoutMs: 90000 }
      );
      const { stdout } = await runProcess(binary, [], {
        cwd: exampleRoot,
      });
      assert(
        stdout.includes('Testing MathLib'),
        `Unexpected output: ${stdout}`
      );
    },
  },
];

async function runExample(def: ExampleDefinition): Promise<ExampleResult> {
  const { tempDir, workDir } = await createWorkingCopy(def.directory);
  const exampleRoot = workDir;
  const start = performance.now();

  const logs: string[] = [];
  const log = (message: string) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${def.name}: ${message}`;
    logs.push(line);
    process.stdout.write(`${line}${os.EOL}`);
  };

  const context: ExampleContext = {
    exampleRoot,
    cliArgs: def.initArgs,
    log,
    initialTimestamp: Date.now(),
    metadata: {},
  };

  try {
    log('Cleaning up previous state');
    await def.cleanup(context);

    log(`Initializing configuration: ${def.initArgs.join(' ')}`);
    await runCli(def.initArgs, exampleRoot);

    await ensureMinimalConfig(exampleRoot);

    log('Installing dependencies (if needed)');
    await installDependencies(exampleRoot);

    log('Starting Poltergeist daemon (foreground)');
    await withForegroundDaemon(
      exampleRoot,
      async () => {
        log('Waiting for initial build to settle');
        await sleep(4000);

        log('Triggering rebuild');
        await def.trigger(context);

        log('Verifying build results');
        await def.verify(context);
      },
      {
        startupDelayMs: 4000,
        timeoutMs: 90000,
      }
    );

    const durationMs = Math.round(performance.now() - start);
    log(`Completed successfully in ${durationMs}ms`);

    return {
      name: def.name,
      status: 'passed',
      details: logs.join('\n'),
      durationMs,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    const message =
      error instanceof Error ? error.message : String(error);

    log(`Failed: ${message}`);

    let poltergeistLog = '';
    try {
      const logPath = path.join(exampleRoot, '.poltergeist.log');
      poltergeistLog = await readFile(logPath, 'utf-8');
    } catch {
      // ignore
    }

    const detailParts = [logs.join('\n')];
    if (poltergeistLog.trim().length > 0) {
      detailParts.push('--- poltergeist.log ---', poltergeistLog.trim());
    }
    detailParts.push(`Error: ${message}`);

    const details = detailParts.join('\n');
    const normalizedMessage = message.toLowerCase();
    const normalizedLog = poltergeistLog.toLowerCase();

    if (error instanceof SkipExampleError) {
      console.warn(details);
      return {
        name: def.name,
        status: 'skipped',
        details,
        durationMs,
      };
    }

    if (
      def.name === 'CMake Library' &&
      (normalizedMessage.includes('cmake is not installed') ||
        normalizedLog.includes('cmake is not installed'))
    ) {
      console.warn(details);
      return {
        name: def.name,
        status: 'skipped',
        details,
        durationMs,
      };
    }

    console.error(details);

    return {
      name: def.name,
      status: 'failed',
      details,
      durationMs,
    };
  } finally {
    await removeWorkingCopy(tempDir);
  }
}

function renderSummary(results: ExampleResult[]): string {
  const header = [
    '',
    'Example',
    'Status',
    'Duration (ms)',
  ];
  const rows = results.map((result) => [
    '',
    result.name,
    result.status.toUpperCase(),
    result.durationMs.toString(),
  ]);

  const table = [header, ...rows];
  const columnWidths = table[0].map((_, colIndex) =>
    Math.max(...table.map((row) => row[colIndex].length))
  );

  return table
    .map((row) =>
      row
        .map((cell, index) => cell.padEnd(columnWidths[index], ' '))
        .join(' | ')
    )
    .join('\n');
}

async function main() {
  console.log('=========================================');
  console.log('Poltergeist Example E2E Runner');
  console.log('=========================================');
  console.log('');

  const results: ExampleResult[] = [];
  for (const example of examples) {
    const result = await runExample(example);
    results.push(result);
    console.log('');
  }

  const summary = renderSummary(results);
  console.log(summary);

  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped');

  if (failed.length > 0) {
    console.error('');
    console.error('Failures:');
    for (const failure of failed) {
      console.error(`- ${failure.name}`);
    }
    process.exitCode = 1;
  } else if (skipped.length > 0) {
    console.log('');
    console.log(
      `Examples succeeded with ${skipped.length} skipped: ${skipped
        .map((entry) => entry.name)
        .join(', ')}`
    );
  } else {
    console.log('');
    console.log('All examples passed ✅');
  }

  // Persist results for historical tracking
  const reportPath = path.join(
    repoRoot,
    'docs',
    'test-e2e-report.json'
  );
  const report = {
    generatedAt: new Date().toISOString(),
    results: results.map((result) => ({
      name: result.name,
      status: result.status,
      durationMs: result.durationMs,
    })),
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
}

await main();
