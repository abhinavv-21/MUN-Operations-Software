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

const req = (url: string, init?: RequestInit) => new Request(`https://example.test${url}`, init)
const post = (url: string, body?: unknown) =>
  req(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

async function seed() {
  const { POST } = await import('../src/app/api/orgs/route.ts')
  signedIn = ALICE
  await POST(post('/api/orgs', { name: 'Alpha MUN Society', slug: 'zz-alpha' }), undefined)

  const org = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: 'zz-alpha' } })
  const conference = await unsafeDb.conference.create({
    data: { organizationId: org.id, slug: 'mun-xi', name: 'Alpha MUN XI', status: 'OPEN' },
  })
  const registration = await unsafeDb.registration.create({
    data: {
      conferenceId: conference.id,
      reference: 'MUNXI-ABC234',
      fullName: 'Priya Sharma',
      email: 'priya@school.test',
      schoolName: 'Lucknow Public School',
      // The applicant asked for UNSC. Approval must ignore it.
      committeePreference: 'UNSC',
    },
  })
  return { org, conference, registration }
}

async function approve(conferenceId: string, registrationId: string) {
  const { POST } = await import(
    '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/registrations/[registrationId]/approve/route.ts'
  )
  return POST(
    post(`/api/orgs/zz-alpha/conferences/${conferenceId}/registrations/${registrationId}/approve`),
    params({ orgSlug: 'zz-alpha', conferenceId, registrationId }),
  )
}

async function reject(conferenceId: string, registrationId: string, reason: unknown) {
  const { POST } = await import(
    '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/registrations/[registrationId]/reject/route.ts'
  )
  return POST(
    post(
      `/api/orgs/zz-alpha/conferences/${conferenceId}/registrations/${registrationId}/reject`,
      { reason },
    ),
    params({ orgSlug: 'zz-alpha', conferenceId, registrationId }),
  )
}

describeWithDb('the review queue', () => {
  beforeEach(async () => {
    await resetDatabase()
    await unsafeDb.delegate.deleteMany({})
    await unsafeDb.registration.deleteMany({})
    signedIn = null
  })

  afterAll(async () => {
    await resetDatabase()
  })

  it('creates a delegate on approval and allocates nothing', async () => {
    const { conference, registration } = await seed()

    const response = await approve(conference.id, registration.id)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.delegate.email).toBe('priya@school.test')

    // The guarantee this test is named after. The applicant said UNSC; nothing
    // in the product acted on that.
    const delegate = await unsafeDb.delegate.findFirstOrThrow()
    expect(delegate.registrationId).toBe(registration.id)
    expect(Object.values(delegate)).not.toContain('UNSC')

    const after = await unsafeDb.registration.findUniqueOrThrow({ where: { id: registration.id } })
    expect(after.status).toBe('APPROVED')
    expect(after.reviewedByUserId).toBeTruthy()
  })

  it('refuses to approve the same application twice', async () => {
    const { conference, registration } = await seed()
    await approve(conference.id, registration.id)

    const second = await approve(conference.id, registration.id)

    // Approving twice would try to mint a second delegate for one application.
    expect(second.status).toBe(409)
    expect(await unsafeDb.delegate.count()).toBe(1)
  })

  it('refuses to reject something already approved', async () => {
    const { conference, registration } = await seed()
    await approve(conference.id, registration.id)

    const response = await reject(conference.id, registration.id, 'changed our minds')
    const body = await response.json()

    // Otherwise a real Delegate row is left behind with no application backing
    // it. The operator has to resolve that explicitly.
    expect(response.status).toBe(409)
    expect(body.error).toContain('Delete the delegate')
  })

  it('requires a reason to reject', async () => {
    const { conference, registration } = await seed()

    const response = await reject(conference.id, registration.id, '')

    // "Why was I turned down" is asked weeks later, by someone who was not in
    // the room.
    expect(response.status).toBe(422)
    expect(await unsafeDb.registration.findUniqueOrThrow({ where: { id: registration.id } })).toMatchObject(
      { status: 'PENDING' },
    )
  })

  it('records the reason and the reviewer', async () => {
    const { conference, registration } = await seed()

    const response = await reject(conference.id, registration.id, 'Applied to the wrong conference')

    expect(response.status).toBe(200)
    const row = await unsafeDb.registration.findUniqueOrThrow({ where: { id: registration.id } })
    expect(row.rejectionReason).toBe('Applied to the wrong conference')
    expect(row.reviewedByUserId).toBeTruthy()
  })

  it('lets a rejected applicant reapply, then be approved', async () => {
    const { org, conference, registration } = await seed()
    await reject(conference.id, registration.id, 'Incomplete')

    // Registration.email is deliberately not unique: a rejected applicant may
    // legitimately reapply, and a school secretary submits for two students
    // from one inbox.
    const second = await unsafeDb.registration.create({
      data: {
        conferenceId: conference.id,
        reference: 'MUNXI-XYZ789',
        fullName: 'Priya Sharma',
        email: 'priya@school.test',
      },
    })

    expect((await approve(conference.id, second.id)).status).toBe(201)
    expect(await unsafeDb.delegate.count({ where: { conferenceId: conference.id } })).toBe(1)
    void org
  })

  it('lets the same person be a delegate at two conferences', async () => {
    const { org, conference, registration } = await seed()
    await approve(conference.id, registration.id)

    const other = await unsafeDb.conference.create({
      data: { organizationId: org.id, slug: 'mun-x', name: 'Alpha MUN X', status: 'OPEN' },
    })
    const otherRegistration = await unsafeDb.registration.create({
      data: {
        conferenceId: other.id,
        reference: 'MUNX-QRS456',
        fullName: 'Priya Sharma',
        email: 'priya@school.test',
      },
    })

    // The reference product's globally unique Delegate.email makes this
    // impossible, which is the bug this schema exists to fix.
    expect((await approve(other.id, otherRegistration.id)).status).toBe(201)
    expect(await unsafeDb.delegate.count()).toBe(2)
  })

  it('stops approving once the delegate ceiling is reached', async () => {
    const { org, conference } = await seed()
    await unsafeDb.organization.update({
      where: { id: org.id },
      data: { planLimits: { maxDelegatesPerConference: 1 } },
    })

    const first = await unsafeDb.registration.findFirstOrThrow()
    expect((await approve(conference.id, first.id)).status).toBe(201)

    const second = await unsafeDb.registration.create({
      data: {
        conferenceId: conference.id,
        reference: 'MUNXI-DEF345',
        fullName: 'Arjun Rao',
        email: 'arjun@school.test',
      },
    })

    const response = await approve(conference.id, second.id)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.details).toMatchObject({ limit: 'maxDelegatesPerConference' })
    expect(await unsafeDb.delegate.count()).toBe(1)
  })
})
