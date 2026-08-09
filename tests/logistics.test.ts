import { randomUUID } from 'node:crypto'
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

const ALICE: AccessTokenClaims = { sub: 'zz_auth_log_alice', email: 'alice@logistics.test' }

const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

const send = (method: string, url: string, payload?: unknown) =>
  new Request(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })

describeWithDb('logistics requests', () => {
  const ORG = 'zz-logistics-org'
  let conferenceId = ''
  let committeeId = ''

  beforeEach(async () => {
    await resetDatabase()
    signedIn = ALICE

    const orgs = await import('../src/app/api/orgs/route.ts')
    await orgs.POST(send('POST', '/api/orgs', { name: 'Logistics Society', slug: ORG }), undefined)

    const organization = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: ORG } })
    const conference = await unsafeDb.conference.create({
      data: { organizationId: organization.id, slug: 'mun-x', name: 'MUN X', status: 'OPEN' },
    })
    conferenceId = conference.id
    committeeId = (
      await unsafeDb.committee.create({
        data: { conferenceId, code: 'UNSC', name: 'Security Council' },
      })
    ).id
  })

  afterAll(async () => {
    await resetDatabase()
    signedIn = null
  })

  const create = async (payload: unknown) => {
    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/logistics/route.ts'
    )
    return route.POST(
      send('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/logistics`, payload),
      params({ orgSlug: ORG, conferenceId }),
    )
  }

  const update = async (requestId: string, payload: unknown) => {
    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/logistics/[requestId]/route.ts'
    )
    return route.PATCH(
      send('PATCH', `/api/orgs/${ORG}/conferences/${conferenceId}/logistics/${requestId}`, payload),
      params({ orgSlug: ORG, conferenceId, requestId }),
    )
  }

  it('raises a request', async () => {
    const response = await create({
      title: 'Projector in UNSC has no signal',
      category: 'TECHNICAL',
      priority: 'URGENT',
      committeeId,
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.replayed).toBe(false)
    expect(body.request.status).toBe('OPEN')
    expect(body.request.committee.code).toBe('UNSC')
  })

  /**
   * The property that makes the offline queue safe for this write.
   *
   * A queued POST is replayed on reconnect, and nothing else distinguishes
   * "more chairs in UNSC" typed twice on purpose from the same request flushed
   * twice. Without the token, a flaky connection multiplies every request by
   * the number of times the flush ran.
   */
  it('replays the same clientRequestId into the same row, with the same 201', async () => {
    const clientRequestId = randomUUID()

    const first = await create({ title: 'More chairs in UNSC', clientRequestId })
    const replay = await create({ title: 'More chairs in UNSC', clientRequestId })

    expect(first.status).toBe(201)
    expect(replay.status).toBe(201)

    const firstBody = await first.json()
    const replayBody = await replay.json()

    expect(replayBody.request.id).toBe(firstBody.request.id)
    expect(replayBody.replayed).toBe(true)
    expect(await unsafeDb.logisticsRequest.count()).toBe(1)
  })

  it('records the replay, so a bad connection leaves a trace', async () => {
    const clientRequestId = randomUUID()
    await create({ title: 'More chairs in UNSC', clientRequestId })
    await create({ title: 'More chairs in UNSC', clientRequestId })

    expect(await unsafeDb.auditLog.count({ where: { action: 'logistics.create' } })).toBe(1)
    expect(await unsafeDb.auditLog.count({ where: { action: 'logistics.replay' } })).toBe(1)
  })

  it('keeps two genuinely separate requests separate when neither carries a token', async () => {
    await create({ title: 'More chairs in UNSC' })
    await create({ title: 'More chairs in UNSC' })

    // No token means no claim of idempotency. Two identical requests typed by
    // two people are two requests, and guessing otherwise would lose one.
    expect(await unsafeDb.logisticsRequest.count()).toBe(2)
  })

  it('survives the queue flushing twice at once', async () => {
    const clientRequestId = randomUUID()

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => create({ title: 'More chairs in UNSC', clientRequestId })),
    )

    expect(responses.every((response) => response.status === 201)).toBe(true)
    expect(await unsafeDb.logisticsRequest.count()).toBe(1)
  })

  it('refuses to resolve without saying what was done', async () => {
    const created = await (await create({ title: 'More chairs in UNSC' })).json()
    const response = await update(created.request.id, { status: 'RESOLVED' })
    const body = await response.json()

    // "Resolved" with no note is the state that makes a logistics board useless
    // next year: nobody can tell whether the chairs arrived.
    expect(response.status).toBe(422)
    expect(body.details).toEqual([{ path: 'resolution', message: expect.any(String) }])
  })

  it('resolves with a note, and reopening clears the closure', async () => {
    const created = await (await create({ title: 'More chairs in UNSC' })).json()

    await update(created.request.id, { status: 'RESOLVED', resolution: 'Brought six from 201' })
    const resolved = await unsafeDb.logisticsRequest.findUniqueOrThrow({
      where: { id: created.request.id },
    })
    expect(resolved.status).toBe('RESOLVED')
    expect(resolved.resolvedAt).not.toBeNull()
    expect(resolved.resolvedByUserId).not.toBeNull()

    await update(created.request.id, { status: 'OPEN' })
    const reopened = await unsafeDb.logisticsRequest.findUniqueOrThrow({
      where: { id: created.request.id },
    })
    // A resolved-at in the past on a request that is open again is a lie the
    // board would print.
    expect(reopened.resolvedAt).toBeNull()
    expect(reopened.resolvedByUserId).toBeNull()
  })

  it('refuses a committee from another conference with a 404', async () => {
    const other = await unsafeDb.organization.create({
      data: { slug: 'zz-logistics-other', name: 'Other Society' },
    })
    const otherConference = await unsafeDb.conference.create({
      data: { organizationId: other.id, slug: 'mun-x', name: 'Other MUN X' },
    })
    const otherCommittee = await unsafeDb.committee.create({
      data: { conferenceId: otherConference.id, code: 'WHO', name: 'World Health Organization' },
    })

    const response = await create({ title: 'Chairs', committeeId: otherCommittee.id })

    expect(response.status).toBe(404)
    expect(await unsafeDb.logisticsRequest.count()).toBe(0)
  })

  it('sorts urgent work above the requests for pens', async () => {
    await create({ title: 'Pens for the press corps', priority: 'LOW' })
    await create({ title: 'A delegate has fainted', priority: 'URGENT', category: 'MEDICAL' })

    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/logistics/route.ts'
    )
    const body = await (
      await route.GET(
        send('GET', `/api/orgs/${ORG}/conferences/${conferenceId}/logistics`),
        params({ orgSlug: ORG, conferenceId }),
      )
    ).json()

    expect(body.requests[0].title).toBe('A delegate has fainted')
    expect(body.summary).toMatchObject({ OPEN: 2, urgentOutstanding: 1 })
  })
})
