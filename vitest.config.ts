import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // The integration tests share one local database and truncate between
    // files. Running files in parallel would have them truncate each other.
    fileParallelism: false,
    // With parallelism already off, isolation buys nothing and costs a fresh
    // module registry per file — which means a fresh globalThis, which means
    // the "no database" notice printed once per file instead of once per run.
    isolate: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
