import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Use forks pool to support process.chdir() in tests
    pool: 'forks',
    poolOptions: {
      forks: {
        // Reduce concurrency on Windows to minimize race conditions
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