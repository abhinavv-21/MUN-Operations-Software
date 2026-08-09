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
    // Isolation stays ON. Turning it off shares one module registry across
    // files, which means a `vi.mock` in one file can reach the next one — the
    // membership suite stubs the session module, and without isolation the API
    // contract suite silently inherited that stub. A tidier skip notice is not
    // worth tests that pass for a reason you did not write.
    isolate: true,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
