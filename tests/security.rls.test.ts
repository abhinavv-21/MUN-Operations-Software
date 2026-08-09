import { expect, it } from 'vitest'
import { unsafeDb } from '../src/server/db.ts'
import { describeWithDb } from './support/harness.ts'

/**
 * The two facts the deny-all RLS design rests on.
 *
 * Both are properties of the database rather than of our code, which is exactly
 * why they need tests: nothing in the repository changes when a Supabase
 * upgrade alters a role's attributes, and the failure mode is either "the app
 * cannot read its own tables" or "the internet can".
 */
describeWithDb('row level security', () => {
  it('connects as a role that bypasses RLS', async () => {
    const rows = await unsafeDb.$queryRaw<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user
    `

    // If this ever returns false against Supabase, every query in the product
    // starts returning zero rows, because the policies deliberately do not
    // exist. Better to learn that here than from an empty dashboard.
    expect(rows[0]?.rolbypassrls).toBe(true)
  })

  /**
   * This is the load-bearing one, verified against the real Supabase project on
   * 2026-08-09 by creating a table and inspecting what it inherited:
   *
   *   grants  -> postgres, service_role only. Not anon, not authenticated.
   *   RLS     -> off.
   *
   * So the grant side takes care of itself: Supabase's default ACL that grants
   * the browser-reachable roles is registered for `supabase_admin`, and our
   * migrations run as `postgres`. The REVOKE in the Stage 1 security migration
   * still matters for the tables that existed when it ran, but it is not what
   * protects the next one.
   *
   * Row level security is different. A table added in Stage 4 or Stage 6
   * arrives with RLS off and no policies, which is wide open rather than
   * closed. Nothing in Postgres will turn it on for us — event triggers need a
   * superuser and our role is not one. This test is the entire mechanism.
   */
  it('has row level security enabled on every table', async () => {
    const unprotected = await unsafeDb.$queryRaw<{ tablename: string }[]>`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity = false
      ORDER BY c.relname
    `

    expect(
      unprotected.map((row) => row.tablename),
      'These tables are readable through PostgREST by anyone holding the publishable ' +
        'anon key. Add the ENABLE ROW LEVEL SECURITY block from the Stage 1 security ' +
        'migration to the migration that created them.',
    ).toEqual([])
  })

  it('carries no policies, because the absence of them is the deny', async () => {
    const policies = await unsafeDb.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_policies WHERE schemaname = 'public'
    `

    // A policy added here would be the first thing to grant browser-side access
    // to a table, which is the opposite of what this design does.
    expect(Number(policies[0]?.count ?? 0)).toBe(0)
  })
})
