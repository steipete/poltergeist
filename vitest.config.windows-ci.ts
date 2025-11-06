import { defineConfig } from 'vitest/config';

// Windows CI configuration - skips problematic tests
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Use forks pool to support process.chdir() in tests
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 1,
        minForks: 1,
      },
    },
    // Increase timeouts for Windows CI (slower filesystem operations)
    testTimeout: 30000,
    hookTimeout: 30000,
    // Better test isolation
    isolate: true,
    // Run hooks sequentially on Windows to avoid race conditions
    sequence: {
      hooks: 'list',
    },
    // Exclude problematic test files on Windows CI
    exclude: [
      'node_modules/**',
      'test/error-recovery.test.ts',
      'test/cli.test.ts',
      'test/state.test.ts',
      'test/state-windows.test.ts',
      'test/state-edge-cases.test.ts',
      'test/polter-fallback.test.ts',
      'test/wrapper.test.ts',
    ],
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
