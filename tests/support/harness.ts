import { describe } from 'vitest'
import { unsafeDb } from '../../src/server/db.ts'

/**
 * `describe` for suites that need a real Postgres. Skips rather than fails when
 * there is not one, with the reason already printed by tests/setup.ts.
 */
export const describeWithDb: typeof describe | typeof describe.skip =
  globalThis.__DB_AVAILABLE__ ? describe : describe.skip

export const skipReason = () => globalThis.__DB_SKIP_REASON__

/**
 * Fixtures are namespaced so a half-finished run is obvious in the database and
 * cheap to sweep, exactly as in the reference product.
 */
export const FIXTURE_PREFIX = 'zz_'

let counter = 0
export function fixtureName(label: string): string {
  counter += 1
  return `${FIXTURE_PREFIX}${label}_${counter}`
}

/**
 * Removes everything the suite created. Ordered by dependency rather than
 * relying on cascades, so a missing `onDelete` shows up here as a failing
 * teardown instead of as a mystery later.
 */
export async function resetDatabase(): Promise<void> {
  await unsafeDb.auditLog.deleteMany({})
  await unsafeDb.committee.deleteMany({})
  await unsafeDb.conferenceRole.deleteMany({})
  await unsafeDb.conference.deleteMany({})
  await unsafeDb.invitation.deleteMany({})
  await unsafeDb.membership.deleteMany({})
  await unsafeDb.organization.deleteMany({})
  await unsafeDb.user.deleteMany({})
}

export interface TwoOrgFixture {
  orgA: { id: string; slug: string }
  orgB: { id: string; slug: string }
  conferenceA: { id: string }
  conferenceB: { id: string }
}

/**
 * Two organisations, one conference each, with a committee in each conference.
 * Every isolation test needs exactly this, and building it inline in each test
 * is how the fixtures drift apart.
 */
export async function seedTwoTenants(): Promise<TwoOrgFixture> {
  const orgA = await unsafeDb.organization.create({
    data: { slug: fixtureName('org_a'), name: 'Alpha Model UN Society' },
  })
  const orgB = await unsafeDb.organization.create({
    data: { slug: fixtureName('org_b'), name: 'Beta Model UN Society' },
  })

  const conferenceA = await unsafeDb.conference.create({
    data: { organizationId: orgA.id, slug: 'mun-x', name: 'Alpha MUN X' },
  })
  const conferenceB = await unsafeDb.conference.create({
    data: { organizationId: orgB.id, slug: 'mun-x', name: 'Beta MUN X' },
  })

  await unsafeDb.committee.create({
    data: { conferenceId: conferenceA.id, code: 'UNSC', name: 'Security Council' },
  })
  await unsafeDb.committee.create({
    data: { conferenceId: conferenceB.id, code: 'WHO', name: 'World Health Organization' },
  })

  return { orgA, orgB, conferenceA, conferenceB }
}
