import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessTokenClaims } from '../src/server/auth/verify.ts'
import { unsafeDb } from '../src/server/db.ts'
import { formatDay, parseDay } from '../src/server/services/attendance.ts'
import { describeWithDb, resetDatabase } from './support/harness.ts'

let signedIn: AccessTokenClaims | null = null

vi.mock('../src/server/auth/session.ts', () => ({
  optionalClaims: async () => signedIn,
  requireClaims: async () => {
    if (!signedIn) throw new Error('not signed in')
    return signedIn
  },
}))

const ALICE: AccessTokenClaims = { sub: 'zz_auth_att_alice', email: 'alice@attendance.test' }
const MALLORY: AccessTokenClaims = { sub: 'zz_auth_att_mallory', email: 'mallory@attendance.test' }

const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

const post = (url: string, payload: unknown) =>
  new Request(`https://example.test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

const get = (url: string) => new Request(`https://example.test${url}`)

describe('the calendar day', () => {
  it('parses and formats without moving a day', () => {
    // Stored in a DATE column. A `coerce.date()` here would accept an instant
    // and shift the whole register by one day for anyone east of Greenwich.
    expect(formatDay(parseDay('2026-03-14'))).toBe('2026-03-14')
    expect(parseDay('2026-03-14').toISOString()).toBe('2026-03-14T00:00:00.000Z')
  })
})

describeWithDb('attendance', () => {
  const ORG = 'zz-attendance-org'
  let conferenceId = ''
  let delegateId = ''
  let otherConferenceId = ''
  let otherDelegateId = ''

  beforeEach(async () => {
    await resetDatabase()
    await unsafeDb.assignment.deleteMany({})
    await unsafeDb.delegate.deleteMany({})
    signedIn = ALICE

    const orgs = await import('../src/app/api/orgs/route.ts')
    await orgs.POST(post('/api/orgs', { name: 'Attendance Society', slug: ORG }), undefined)

    const organization = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: ORG } })
    const conference = await unsafeDb.conference.create({
      data: { organizationId: organization.id, slug: 'mun-x', name: 'MUN X', status: 'OPEN' },
    })
    conferenceId = conference.id

    const delegate = await unsafeDb.delegate.create({
      data: { conferenceId, fullName: 'Dara Okafor', email: 'dara@attendance.test' },
    })
    delegateId = delegate.id

    // A second organisation, for the isolation checks.
    signedIn = MALLORY
    await orgs.POST(post('/api/orgs', { name: 'Other Society', slug: 'zz-other-org' }), undefined)
    const other = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: 'zz-other-org' } })
    const otherConference = await unsafeDb.conference.create({
      data: { organizationId: other.id, slug: 'mun-x', name: 'Other MUN X', status: 'OPEN' },
    })
    otherConferenceId = otherConference.id
    otherDelegateId = (
      await unsafeDb.delegate.create({
        data: {
          conferenceId: otherConference.id,
          fullName: 'Someone Else',
          email: 'else@attendance.test',
        },
      })
    ).id

    signedIn = ALICE
  })

  afterAll(async () => {
    await resetDatabase()
    await unsafeDb.delegate.deleteMany({})
    signedIn = null
  })

  const checkIn = async (payload: unknown) => {
    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/attendance/route.ts'
    )
    return route.POST(
      post(`/api/orgs/${ORG}/conferences/${conferenceId}/attendance`, payload),
      params({ orgSlug: ORG, conferenceId }),
    )
  }

  it('marks a delegate present', async () => {
    const response = await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.created).toBe(true)
    expect(body.changed).toBe(true)
    expect(body.record.day).toBe('2026-03-14')
    expect(await unsafeDb.attendanceRecord.count()).toBe(1)
  })

  /**
   * The property the offline queue rests on.
   *
   * A queued check-in is replayed when the connection returns, and may be
   * replayed after the same delegate was marked from another device. If the
   * replay wrote a second row the register would count the delegate twice, and
   * the unique index would surface as a 500 instead.
   */
  it('is idempotent: the same mark twice is one row and no change', async () => {
    await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT' })
    const replay = await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT' })
    const body = await replay.json()

    expect(replay.status).toBe(200)
    expect(body.created).toBe(false)
    expect(body.changed).toBe(false)
    expect(await unsafeDb.attendanceRecord.count()).toBe(1)
  })

  it('records the replay in the audit log even though nothing changed', async () => {
    await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT' })
    await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT' })

    const rows = await unsafeDb.auditLog.findMany({
      where: { action: 'attendance.checkin' },
      orderBy: { id: 'asc' },
    })

    // The record is the state; the log is the history. "This delegate was
    // scanned twice at the door" is a question only the log can answer.
    expect(rows).toHaveLength(2)
    expect((rows[0]!.payloadAfter as { unchanged: boolean }).unchanged).toBe(false)
    expect((rows[1]!.payloadAfter as { unchanged: boolean }).unchanged).toBe(true)
  })

  it('treats a different status as an amendment, not a second row', async () => {
    await checkIn({ delegateId, day: '2026-03-14', status: 'ABSENT' })
    const amended = await checkIn({ delegateId, day: '2026-03-14', status: 'LATE' })

    expect((await amended.json()).changed).toBe(true)
    expect(await unsafeDb.attendanceRecord.count()).toBe(1)
    expect((await unsafeDb.attendanceRecord.findFirstOrThrow({})).status).toBe('LATE')
  })

  /**
   * Attendance is a record of *when*, and a queued mark syncs later than it was
   * made. Writing the flush time meant a delegate marked at 08:47 in a corridor
   * with no signal was recorded as arriving whenever the network came back.
   */
  it('records the time the mark was made, not the time it synced', async () => {
    const madeAt = new Date(Date.now() - 48 * 60_000).toISOString()

    await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT', markedAt: madeAt })

    const record = await unsafeDb.attendanceRecord.findFirstOrThrow({})
    expect(record.markedAt.toISOString()).toBe(madeAt)
  })

  it('refuses a mark time from a device whose clock is ahead', async () => {
    const future = new Date(Date.now() + 6 * 3_600_000).toISOString()
    const before = Date.now()

    await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT', markedAt: future })

    // Clamped to the server's now. A browser clock must not be able to record an
    // arrival in the future and sort itself above marks that came later.
    const record = await unsafeDb.attendanceRecord.findFirstOrThrow({})
    expect(record.markedAt.getTime()).toBeLessThanOrEqual(Date.now())
    expect(record.markedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('keeps each day separate', async () => {
    await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT' })
    await checkIn({ delegateId, day: '2026-03-15', status: 'ABSENT' })

    expect(await unsafeDb.attendanceRecord.count()).toBe(2)
  })

  it('survives two devices marking the same delegate at the same moment', async () => {
    // Serializable, so one inserts and the other retries into finding the row.
    // Without the transaction the second reaches the unique index as a 500.
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT' })),
    )

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200])
    expect(await unsafeDb.attendanceRecord.count()).toBe(1)
  })

  it('refuses a delegate from another conference with a 404', async () => {
    const response = await checkIn({ delegateId: otherDelegateId, day: '2026-03-14' })

    expect(response.status).toBe(404)
    expect(await unsafeDb.attendanceRecord.count()).toBe(0)
  })

  it('refuses another organisation entirely, byte for byte like a conference that does not exist', async () => {
    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/attendance/route.ts'
    )
    const response = await route.POST(
      post(`/api/orgs/${ORG}/conferences/${otherConferenceId}/attendance`, {
        delegateId: otherDelegateId,
        day: '2026-03-14',
      }),
      params({ orgSlug: ORG, conferenceId: otherConferenceId }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found', code: 404 })
  })

  it('answers 422 with a path for a day that is not a date', async () => {
    const response = await checkIn({ delegateId, day: '14/03/2026' })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.details).toEqual([{ path: 'day', message: expect.any(String) }])
  })

  it('lists every delegate, marked or not, with the counts the desk watches', async () => {
    await unsafeDb.delegate.create({
      data: { conferenceId, fullName: 'Sam Lee', email: 'sam@attendance.test' },
    })
    await checkIn({ delegateId, day: '2026-03-14', status: 'PRESENT' })

    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/attendance/route.ts'
    )
    const response = await route.GET(
      get(`/api/orgs/${ORG}/conferences/${conferenceId}/attendance?day=2026-03-14`),
      params({ orgSlug: ORG, conferenceId }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    // Delegate-led, not record-led: a list of marks answers "who came", and
    // what the desk needs is "who has not".
    expect(body.delegates).toHaveLength(2)
    expect(body.summary).toMatchObject({ total: 2, present: 1, unmarked: 1 })
  })
})
