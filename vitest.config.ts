import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // DB-backed integration tests: run files sequentially to avoid
    // cross-file interference on shared counters (lockout, rate limits).
    sequence: { shuffle: false },
    pool: 'forks',
    maxWorkers: 1,
  },
});
