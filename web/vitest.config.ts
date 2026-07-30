import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      reporter: ['text', 'json-summary'],
      include: ['src/lib/**/*.ts'],
    },
  },
});
