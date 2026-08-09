import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import type { AccessTokenClaims } from '../src/server/auth/verify.ts'
import { unsafeDb } from '../src/server/db.ts'
import { describeWithDb, resetDatabase } from './support/harness.ts'

let signedIn: AccessTokenClaims | null = null

vi.mock('../src/server/auth/session.ts', () => ({
  optionalClaims: async () => signedIn,
  requireClaims: async () => {
    if (!signedIn) throw new Error('not signed in')
    return signedIn
  },
}))

const ALICE: AccessTokenClaims = { sub: 'zz_auth_aw_alice', email: 'alice@awards.test' }
const CHARLIE: AccessTokenClaims = { sub: 'zz_auth_aw_charlie', email: 'charlie@awards.test' }

const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

const send = (method: string, url: string, payload?: unknown) =>
  new Request(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })

describeWithDb('awards', () => {
  const ORG = 'zz-awards-org'
  let conferenceId = ''
  let unsc = ''
  let who = ''
  let dara = ''
  let sam = ''
  let unallocated = ''
  let charlieUserId = ''

  beforeEach(async () => {
    await resetDatabase()
    await unsafeDb.assignment.deleteMany({})
    await unsafeDb.delegate.deleteMany({})
    signedIn = ALICE

    const orgs = await import('../src/app/api/orgs/route.ts')
    await orgs.POST(send('POST', '/api/orgs', { name: 'Awards Society', slug: ORG }), undefined)

    const organization = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: ORG } })
    const conference = await unsafeDb.conference.create({
      data: { organizationId: organization.id, slug: 'mun-x', name: 'MUN X', status: 'OPEN' },
    })
    conferenceId = conference.id

    unsc = (
      await unsafeDb.committee.create({
        data: { conferenceId, code: 'UNSC', name: 'Security Council' },
      })
    ).id
    who = (
      await unsafeDb.committee.create({
        data: { conferenceId, code: 'WHO', name: 'World Health Organization' },
      })
    ).id

    dara = (
      await unsafeDb.delegate.create({
        data: { conferenceId, fullName: 'Dara Okafor', email: 'dara@awards.test' },
      })
    ).id
    sam = (
      await unsafeDb.delegate.create({
        data: { conferenceId, fullName: 'Sam Lee', email: 'sam@awards.test' },
      })
    ).id
    unallocated = (
      await unsafeDb.delegate.create({
        data: { conferenceId, fullName: 'Noor Haddad', email: 'noor@awards.test' },
      })
    ).id

    await unsafeDb.assignment.create({
      data: { conferenceId, committeeId: unsc, delegateId: dara, country: 'France' },
    })
    await unsafeDb.assignment.create({
      data: { conferenceId, committeeId: who, delegateId: sam, country: 'Japan' },
    })

    // A conference CONTRIBUTOR, for the role checks.
    const charlie = await unsafeDb.user.create({
      data: {
        authUserId: CHARLIE.sub,
        email: CHARLIE.email!,
        profileCompletedAt: new Date(),
      },
    })
    charlieUserId = charlie.id
    await unsafeDb.membership.create({
      data: { userId: charlie.id, organizationId: organization.id, role: 'MEMBER' },
    })
    await unsafeDb.conferenceRole.create({
      data: { userId: charlie.id, conferenceId, role: 'CONTRIBUTOR' },
    })
  })

  afterAll(async () => {
    await resetDatabase()
    await unsafeDb.delegate.deleteMany({})
    signedIn = null
  })

  const give = async (payload: unknown) => {
    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/awards/route.ts'
    )
    return route.POST(
      send('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/awards`, payload),
      params({ orgSlug: ORG, conferenceId }),
    )
  }

  it('gives an award to a delegate sitting in that committee', async () => {
    const response = await give({ committeeId: unsc, delegateId: dara, title: 'Best Delegate' })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.award.delegate.fullName).toBe('Dara Okafor')
    expect(body.award.committee.code).toBe('UNSC')
  })

  /**
   * Filled in at speed from two dropdowns while the ceremony is being lined up.
   * Picking the wrong committee otherwise produces a certificate with the wrong
   * committee printed on it, discovered by the delegate, on stage.
   */
  it('refuses a delegate who is not in the committee giving the award', async () => {
    const response = await give({ committeeId: unsc, delegateId: sam, title: 'Best Delegate' })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.details).toEqual([
      { path: 'committeeId', message: expect.stringContaining('not in UNSC') },
    ])
    expect(await unsafeDb.award.count()).toBe(0)
  })

  it('refuses a delegate with no allocation at all', async () => {
    const response = await give({ committeeId: unsc, delegateId: unallocated, title: 'Best Delegate' })

    expect(response.status).toBe(422)
    expect((await response.json()).details[0].path).toBe('delegateId')
  })

  it('lets several delegates share a verbal mention in one committee', async () => {
    const second = await unsafeDb.delegate.create({
      data: { conferenceId, fullName: 'Ana Ruiz', email: 'ana@awards.test' },
    })
    await unsafeDb.assignment.create({
      data: { conferenceId, committeeId: unsc, delegateId: second.id, country: 'Brazil' },
    })

    expect((await give({ committeeId: unsc, delegateId: dara, title: 'Verbal Mention' })).status).toBe(201)
    expect(
      (await give({ committeeId: unsc, delegateId: second.id, title: 'Verbal Mention' })).status,
    ).toBe(201)

    // The tempting stronger constraint — one title per committee — forbids the
    // normal case, and gets worked around by typing "Verbal Mention 2".
    expect(await unsafeDb.award.count()).toBe(2)
  })

  it('refuses the same award to the same delegate twice, as a 409', async () => {
    await give({ committeeId: unsc, delegateId: dara, title: 'Best Delegate' })
    const again = await give({ committeeId: unsc, delegateId: dara, title: 'Best Delegate' })

    expect(again.status).toBe(409)
    expect(await unsafeDb.award.count()).toBe(1)
  })

  it('is closed to a conference CONTRIBUTOR', async () => {
    signedIn = CHARLIE
    const response = await give({ committeeId: unsc, delegateId: dara, title: 'Best Delegate' })

    /*
      403 and not 404, and the difference is deliberate. The conference is
      inside Charlie's own organisation, so its existence is not a secret from
      him — what he lacks is the rank. The 404-not-403 rule is about hiding
      other tenants' data, not an organisation's own chain of command.
    */
    expect(response.status).toBe(403)
    expect(await unsafeDb.award.count()).toBe(0)
    expect(charlieUserId).not.toBe('')
  })

  it('lets a CONTRIBUTOR read the list they have to read out', async () => {
    await give({ committeeId: unsc, delegateId: dara, title: 'Best Delegate' })

    signedIn = CHARLIE
    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/awards/route.ts'
    )
    const response = await route.GET(
      send('GET', `/api/orgs/${ORG}/conferences/${conferenceId}/awards`),
      params({ orgSlug: ORG, conferenceId }),
    )

    expect(response.status).toBe(200)
    expect((await response.json()).awards).toHaveLength(1)
  })

  it('removes an award and records what was removed', async () => {
    const created = await (
      await give({ committeeId: unsc, delegateId: dara, title: 'Best Delegate' })
    ).json()

    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/awards/[awardId]/route.ts'
    )
    const response = await route.DELETE(
      send('DELETE', `/api/orgs/${ORG}/conferences/${conferenceId}/awards/${created.award.id}`),
      params({ orgSlug: ORG, conferenceId, awardId: created.award.id }),
    )

    expect(response.status).toBe(200)
    expect(await unsafeDb.award.count()).toBe(0)

    const audit = await unsafeDb.auditLog.findFirstOrThrow({ where: { action: 'award.remove' } })
    expect((audit.payloadBefore as { title: string }).title).toBe('Best Delegate')
  })
})
