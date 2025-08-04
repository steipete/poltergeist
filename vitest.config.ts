import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Windows CI compatibility: use sequential execution to avoid race conditions
    pool: process.platform === 'win32' ? 'forks' : 'threads',
    poolOptions: {
      threads: {
        // Reduce concurrency on Windows to minimize race conditions
        maxThreads: process.platform === 'win32' ? 1 : undefined,
        minThreads: process.platform === 'win32' ? 1 : undefined,
      },
      forks: {
        // Use single process on Windows for better test isolation
        maxForks: process.platform === 'win32' ? 1 : undefined,
        minForks: process.platform === 'win32' ? 1 : undefined,
      },
    },
    // Increase timeouts for Windows CI (slower filesystem operations)
    testTimeout: process.platform === 'win32' ? 15000 : 5000,
    hookTimeout: process.platform === 'win32' ? 15000 : 10000,
    // Better test isolation
    isolate: true,
    coverage: {
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        'dist/',
        'apps/',
      ],
    },
  },
  resolve: {
    extensions: ['.js', '.ts', '.json'],
  },
});