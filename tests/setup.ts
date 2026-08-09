/**
 * Test setup.
 *
 * The whole point of this file is invariant 5: `npm test` stays green on a
 * laptop with no database, and says why it skipped.
 *
 * This is what kept the reference product's suite honest across 53 commits. A
 * suite that fails for environmental reasons gets ignored, and a suite that is
 * ignored gets deleted.
 *
 * The required variables are checked by hand, before anything that might call
 * `process.exit` on a bad config is imported — a runner that dies with no
 * explanation is worse than one that skips with one.
 */

import { config } from 'dotenv'

config({ path: '.env', quiet: true })

// Point the client at the test database before anything imports it. The
// integration tests truncate, and truncating the development database while
// you have a browser open on it is a bad afternoon.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}

declare global {
  var __DB_AVAILABLE__: boolean
  var __DB_SKIP_REASON__: string | undefined
}

const PROBE_TIMEOUT_MS = 5_000

function missingConfig(): string | undefined {
  if (!process.env.DATABASE_URL) {
    return 'DATABASE_URL is not set. Copy .env.example to .env.'
  }
  return undefined
}

async function probe(): Promise<string | undefined> {
  const configError = missingConfig()
  if (configError) return configError

  try {
    const { unsafeDb } = await import('../src/server/db.ts')
    await Promise.race([
      unsafeDb.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`no response within ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS),
      ),
    ])
    return undefined
  } catch (error) {
    // Prisma's connection errors are several lines of framed text. Collapsed,
    // because a skip notice that scrolls the reason off the screen is not one.
    const detail = (error instanceof Error ? error.message : String(error))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)
    return `Postgres is unreachable at the configured DATABASE_URL (${detail}). Start it with \`mun-pg start\`.`
  }
}

const reason = await probe()

globalThis.__DB_AVAILABLE__ = reason === undefined
globalThis.__DB_SKIP_REASON__ = reason

if (reason) {
  // Setup runs once per test file, so the notice is printed once per process
  // rather than once per file.
  const announced = '__DB_SKIP_ANNOUNCED__'
  if (!(announced in globalThis)) {
    Object.defineProperty(globalThis, announced, { value: true })

    // Written straight to stderr rather than through console.warn, which Vitest
    // buffers per test file and then discards for a file whose tests all
    // skipped. A silent skip is the exact failure this arrangement exists to
    // prevent: the integration suite stops running and nobody notices for a
    // month.
    process.stderr.write(`\n  [33mSkipping the integration suite[0m: ${reason}\n\n`)

    // On a laptop, no database is a fact about the laptop. In CI it is a
    // broken pipeline pretending to be a passing one.
    if (process.env.CI) {
      process.stderr.write('  CI is set, so this is a failure rather than a skip.\n\n')
      process.exit(1)
    }
  }
}
