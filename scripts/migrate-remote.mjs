#!/usr/bin/env node
/**
 * Applies committed migrations to the remote Supabase project.
 *
 * This is `prisma migrate deploy` and never `migrate dev`. Deploy is
 * forward-only: it applies the migrations in the repository and nothing else.
 * `migrate dev` compares the schema against the database, needs a shadow
 * database it is allowed to drop, and generates DROP statements from whatever
 * drift it finds. Pointing that at a shared project is how you lose a table.
 *
 * The remote URLs live in .env.supabase so that they are never in the file the
 * Prisma CLI reads by default.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { config } from 'dotenv'

const ENV_FILE = '.env.supabase'

if (!existsSync(ENV_FILE)) {
  console.error(`\n  ${ENV_FILE} is missing. It holds DATABASE_URL and DIRECT_URL for Supabase.\n`)
  process.exit(1)
}

const parsed = config({ path: ENV_FILE, override: true, quiet: true }).parsed ?? {}

for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (!parsed[key]) {
    console.error(`\n  ${ENV_FILE} does not set ${key}.\n`)
    process.exit(1)
  }
}

const host = new URL(parsed.DIRECT_URL).host
console.log(`\n  Applying migrations to ${host}\n`)

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, ...parsed },
})

process.exit(result.status ?? 1)
