import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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