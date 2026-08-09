import { withApi, json } from '@/server/api.ts'
// This is one of the few files allowed to hold the unscoped client, listed as
// an override in eslint.config.mjs: the health check exists precisely to prove
// the raw connection works, and there is no tenant to scope it to.
import { unsafeDb } from '@/server/db.ts'

/**
 * Health, with a real database round trip.
 *
 * An endpoint that returns a version string without touching Postgres will keep
 * an uptime monitor green while the database is unreachable, or while a
 * Supabase project pauses underneath it. The reference product learned this the
 * expensive way, so this one queries.
 */
export const dynamic = 'force-dynamic'

export const GET = withApi(async () => {
  const startedAt = Date.now()
  const [{ now }] = await unsafeDb.$queryRaw<[{ now: Date }]>`SELECT NOW() AS now`

  return json({
    status: 'ok',
    database: {
      reachable: true,
      roundTripMs: Date.now() - startedAt,
      serverTime: now.toISOString(),
    },
  })
})
