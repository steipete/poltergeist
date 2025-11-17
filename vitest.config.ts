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
    testTimeout: process.platform === 'win32' ? 30000 : 5000,
    hookTimeout: process.platform === 'win32' ? 30000 : 10000,
    // Better test isolation
    isolate: true,
    // Run hooks sequentially on Windows to avoid race conditions
    sequence: {
      hooks: process.platform === 'win32' ? 'list' : 'parallel',
    },
    exclude: [
      'node_modules/**',
      'dist/**',
      ...(process.env.POLTERGEIST_COVERAGE_MODE === 'true'
        ? ['test/polter-*.test.ts', 'tests/**']
        : []),
    ],
    coverage: {
      enabled: true,
      all: true,
      include: [
        'src/utils/paths.ts',
        'src/utils/glob-matcher.ts',
        'src/utils/atomic-write.ts',
        'src/utils/cli-formatter.ts',
        'src/utils/build-status-manager.ts',
      ],
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'test/',
        'dist/',
        'apps/',
        'src/watchman.ts',
        'src/watchman-config.ts',
        // Keep other heavy files excluded; analyzer now covered via helpers/e2e tests
        'src/cli.ts',
        'src/polter.ts',
        'src/daemon/daemon-manager.ts',
        'src/daemon/daemon-manager-bun.ts',
        'src/daemon/daemon-worker.ts',
        'src/builders/npm-builder.ts',
        'src/builders/cmake-builder.ts',
        'src/builders/app-bundle-builder.ts',
        'src/utils/process-manager.ts',
        'src/utils/glob-utils.ts',
        'src/utils/config-manager.ts',
        'src/utils/native-notifier.ts',
        'src/utils/notifier-wrapper.ts',
        'src/utils/watchman-wrapper.ts',
      ],
    },
  },
  resolve: {
    extensions: ['.js', '.ts', '.json'],
  },
});
