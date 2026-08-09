import { afterAll, beforeAll, expect, it } from 'vitest'
import { forConference, forOrganization, unsafeDb } from '../src/server/db.ts'
import { toApiError } from '../src/server/api.ts'
import { describeWithDb, resetDatabase, seedTwoTenants, type TwoOrgFixture } from './support/harness.ts'

/**
 * The Stage 1 exit criterion, minus the coverage test.
 *
 * These prove the guarantee against a real Postgres, because the interesting
 * failures are the ones where Prisma accepts an argument shape and quietly does
 * something other than what the extension intended.
 */
describeWithDb('tenant scoping', () => {
  let fixture: TwoOrgFixture

  beforeAll(async () => {
    await resetDatabase()
    fixture = await seedTwoTenants()
  })

  afterAll(async () => {
    await resetDatabase()
  })

  it('returns none of another conference\'s rows', async () => {
    const a = forConference(fixture.conferenceA.id)

    const rows = await a.committee.findMany()

    expect(rows).toHaveLength(1)
    expect(rows[0]?.code).toBe('UNSC')
    expect(rows.every((row) => row.conferenceId === fixture.conferenceA.id)).toBe(true)
  })

  it('surfaces a cross-conference update as a 404 rather than a silent write', async () => {
    const a = forConference(fixture.conferenceA.id)
    const foreign = await unsafeDb.committee.findFirstOrThrow({
      where: { conferenceId: fixture.conferenceB.id },
    })

    // Prisma answers P2025 for a where clause that matches nothing, and the
    // ladder turns that into a 404. Not a 403: confirming the row exists is
    // itself a disclosure.
    const error = await a.committee
      .update({ where: { id: foreign.id }, data: { name: 'hijacked' } })
      .then(() => undefined)
      .catch((caught: unknown) => toApiError(caught))

    expect(error?.code).toBe(404)

    const untouched = await unsafeDb.committee.findUniqueOrThrow({ where: { id: foreign.id } })
    expect(untouched.name).toBe('World Health Organization')
  })

  it('returns null from findUnique for another conference\'s row', async () => {
    const a = forConference(fixture.conferenceA.id)
    const foreign = await unsafeDb.committee.findFirstOrThrow({
      where: { conferenceId: fixture.conferenceB.id },
    })

    // findUnique is rewritten to findFirst inside the extension. Without that
    // rewrite Prisma rejects the argument shape, and the tempting fix — drop
    // the tenant filter for unique lookups — is the leak itself.
    expect(await a.committee.findUnique({ where: { id: foreign.id } })).toBeNull()
  })

  it('keeps scoping inside an interactive transaction', async () => {
    const a = forConference(fixture.conferenceA.id)

    // Prisma 5+ is documented to yield extended clients from $transaction.
    // Documented is not the same as true in this version with this adapter.
    const seen = await a.$transaction(async (tx) => tx.committee.findMany())

    expect(seen).toHaveLength(1)
    expect(seen[0]?.conferenceId).toBe(fixture.conferenceA.id)
  })

  it('writes the conference id on create without being asked', async () => {
    const a = forConference(fixture.conferenceA.id)

    const created = await a.committee.create({
      data: { code: 'DISEC', name: 'Disarmament and International Security' },
    } as Parameters<typeof a.committee.create>[0])

    expect(created.conferenceId).toBe(fixture.conferenceA.id)
    await unsafeDb.committee.delete({ where: { id: created.id } })
  })

  it('counts and aggregates only within the conference', async () => {
    const a = forConference(fixture.conferenceA.id)
    const b = forConference(fixture.conferenceB.id)

    expect(await a.committee.count()).toBe(1)
    expect(await b.committee.count()).toBe(1)
    expect(await unsafeDb.committee.count()).toBe(2)
  })

  it('deletes nothing across the boundary', async () => {
    const a = forConference(fixture.conferenceA.id)

    const { count } = await a.committee.deleteMany({ where: { code: 'WHO' } })

    expect(count).toBe(0)
    expect(await unsafeDb.committee.count()).toBe(2)
  })

  it('scopes organisation-level models by organisation', async () => {
    const a = forOrganization(fixture.orgA.id)

    const conferences = await a.conference.findMany()

    expect(conferences).toHaveLength(1)
    expect(conferences[0]?.id).toBe(fixture.conferenceA.id)
  })

  it('refuses a conference-scoped read with no conference in scope', async () => {
    const orgOnly = forOrganization(fixture.orgA.id)

    // Failing loudly beats returning every tenant's committees, which is what
    // a permissive fallback would do.
    await expect(orgOnly.committee.findMany()).rejects.toThrow(/conference-scoped/)
  })

  it('refuses upsert on a scoped model rather than running it unscoped', async () => {
    const a = forConference(fixture.conferenceA.id)

    await expect(
      a.committee.upsert({
        where: { id: 'whatever' },
        create: { code: 'X', name: 'X' },
        update: { name: 'X' },
      } as Parameters<typeof a.committee.upsert>[0]),
    ).rejects.toThrow(/upsert is not available/)
  })
})
