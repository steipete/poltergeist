import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // Increase timeout for CI
    hookTimeout: 20000, // Increase hook timeout for CI
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      'apps/**',
      // Skip integration tests that spawn real processes in CI
      'tests/daemon-no-targets.test.ts',
      // Skip tests with known timeout issues in CI environments
      'test/daemon-resilience.test.ts',
      'test/watchman.test.ts',
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        'tests/',
        'dist/',
        'apps/',
        '*.config.ts',
        '*.config.js',
        'src/utils/bun-spawn.ts', // Platform-specific
        'src/utils/watchman-wrapper.ts', // External dependency wrapper
      ],
    },
  },
});