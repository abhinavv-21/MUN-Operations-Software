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

const ALICE: AccessTokenClaims = { sub: 'zz_auth_alice', email: 'alice@example.test' }
const BOB: AccessTokenClaims = { sub: 'zz_auth_bob', email: 'bob@example.test' }

const req = (url: string, init?: RequestInit) => new Request(`https://example.test${url}`, init)
const post = (url: string, body: unknown) =>
  req(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

async function createOrg(name: string, slug: string) {
  const { POST } = await import('../src/app/api/orgs/route.ts')
  return POST(post('/api/orgs', { name, slug }), undefined)
}

async function createConference(orgSlug: string, name: string, slug: string) {
  const { POST } = await import('../src/app/api/orgs/[orgSlug]/conferences/route.ts')
  return POST(post(`/api/orgs/${orgSlug}/conferences`, { name, slug }), params({ orgSlug }))
}

async function createCommittee(orgSlug: string, conferenceId: string, code: string, name: string) {
  const { POST } = await import(
    '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/route.ts'
  )
  return POST(
    post(`/api/orgs/${orgSlug}/conferences/${conferenceId}/committees`, { code, name }),
    params({ orgSlug, conferenceId }),
  )
}

async function listCommittees(orgSlug: string, conferenceId: string) {
  const { GET } = await import(
    '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/route.ts'
  )
  return GET(
    req(`/api/orgs/${orgSlug}/conferences/${conferenceId}/committees`),
    params({ orgSlug, conferenceId }),
  )
}

describeWithDb('conferences and committees', () => {
  beforeEach(async () => {
    await resetDatabase()
    signedIn = null
  })

  afterAll(async () => {
    await resetDatabase()
  })

  it('lets one organisation run several conferences', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    const first = await createConference('zz-alpha', 'Alpha MUN X', 'mun-x')
    const second = await createConference('zz-alpha', 'Alpha MUN XI', 'mun-xi')

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
  })

  it('lets two conferences in one organisation both have a UNSC', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const one = (await (await createConference('zz-alpha', 'MUN X', 'mun-x')).json()).conference
    const two = (await (await createConference('zz-alpha', 'MUN XI', 'mun-xi')).json()).conference

    // Globally unique committee codes are the reference product's model and are
    // a bug the moment a society runs a second edition.
    expect((await createCommittee('zz-alpha', one.id, 'UNSC', 'Security Council')).status).toBe(201)
    expect((await createCommittee('zz-alpha', two.id, 'UNSC', 'Security Council')).status).toBe(201)
  })

  it('refuses a duplicate committee code within one conference', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const conference = (await (await createConference('zz-alpha', 'MUN X', 'mun-x')).json())
      .conference

    await createCommittee('zz-alpha', conference.id, 'UNSC', 'Security Council')
    const duplicate = await createCommittee('zz-alpha', conference.id, 'UNSC', 'Another Council')

    expect(duplicate.status).toBe(409)
  })

  it('answers 404 for a conference id from another organisation', async () => {
    // The exit criterion, and the hole this stage found: an org admin was
    // handed ADMIN on any conference id at all, because the org-admin shortcut
    // ran before anything checked which organisation the conference was in.
    signedIn = BOB
    await createOrg('Beta Model UN Society', 'zz-beta')
    const foreign = (await (await createConference('zz-beta', 'Beta MUN X', 'mun-x')).json())
      .conference
    await createCommittee('zz-beta', foreign.id, 'WHO', 'World Health Organization')

    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    const response = await listCommittees('zz-alpha', foreign.id)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found', code: 404 })
  })

  it('answers 404 for a conference id from another organisation on a write too', async () => {
    signedIn = BOB
    await createOrg('Beta Model UN Society', 'zz-beta')
    const foreign = (await (await createConference('zz-beta', 'Beta MUN X', 'mun-x')).json())
      .conference

    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    const response = await createCommittee('zz-alpha', foreign.id, 'DISEC', 'Disarmament')

    expect(response.status).toBe(404)
    // And nothing was written into the other organisation's conference.
    expect(await unsafeDb.committee.count({ where: { conferenceId: foreign.id } })).toBe(0)
  })

  it('stops a free plan at the third conference, saying which limit', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    expect((await createConference('zz-alpha', 'MUN IX', 'mun-ix')).status).toBe(201)
    expect((await createConference('zz-alpha', 'MUN X', 'mun-x')).status).toBe(201)

    const third = await createConference('zz-alpha', 'MUN XI', 'mun-xi')
    const body = await third.json()

    // 403, not 402. A 402 with no payment mechanism behind it is a lie. The UI
    // keys on details.limit to choose the prompt, not on the status code.
    expect(third.status).toBe(403)
    expect(body.details).toMatchObject({ limit: 'maxConferences', current: 2, max: 2 })
    expect(body.error).toContain('2 conferences')
  })

  it('honours a per-organisation limit override without a deploy', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    await createConference('zz-alpha', 'MUN IX', 'mun-ix')
    await createConference('zz-alpha', 'MUN X', 'mun-x')

    // The whole point of planLimits: a customer emails, and their ceiling is a
    // row update rather than a release.
    await unsafeDb.organization.update({
      where: { slug: 'zz-alpha' },
      data: { planLimits: { maxConferences: 5 } },
    })

    expect((await createConference('zz-alpha', 'MUN XI', 'mun-xi')).status).toBe(201)
  })

  it('does not let a plain member create a conference', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const alpha = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: 'zz-alpha' } })

    // Bob joins as a MEMBER, which on its own grants nothing.
    signedIn = BOB
    const { GET } = await import('../src/app/api/orgs/route.ts')
    await GET(req('/api/orgs'), undefined)
    const bob = await unsafeDb.user.findUniqueOrThrow({ where: { authUserId: BOB.sub } })
    await unsafeDb.membership.create({
      data: { userId: bob.id, organizationId: alpha.id, role: 'MEMBER' },
    })

    const response = await createConference('zz-alpha', 'Sneaky MUN', 'sneaky')

    expect(response.status).toBe(403)
  })

  it('scopes the country matrix to its conference', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const conference = (await (await createConference('zz-alpha', 'MUN X', 'mun-x')).json())
      .conference
    const committee = (
      await (await createCommittee('zz-alpha', conference.id, 'UNSC', 'Security Council')).json()
    ).committee

    const { PUT } = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/[committeeId]/countries/route.ts'
    )
    const response = await PUT(
      req(
        `/api/orgs/zz-alpha/conferences/${conference.id}/committees/${committee.id}/countries`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            countries: [
              { country: 'France', seats: 1 },
              // Same country, different case. One seat, not two.
              { country: 'france', seats: 1 },
              { country: 'Japan', seats: 2 },
            ],
          }),
        },
      ),
      params({ orgSlug: 'zz-alpha', conferenceId: conference.id, committeeId: committee.id }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ count: 2 })

    const rows = await unsafeDb.committeeCountry.findMany()
    expect(rows.every((row) => row.conferenceId === conference.id)).toBe(true)
  })
})
