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

const ALICE: AccessTokenClaims = { sub: 'zz_auth_del_alice', email: 'alice@delete.test' }
const MEMBER: AccessTokenClaims = { sub: 'zz_auth_del_member', email: 'member@delete.test' }

const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

const send = (method: string, url: string, payload?: unknown) =>
  new Request(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })

describeWithDb('deleting a conference', () => {
  const ORG = 'zz-delete-org'
  const NAME = 'Deletable MUN'
  let organizationId = ''
  let conferenceId = ''
  let survivorId = ''

  beforeEach(async () => {
    await resetDatabase()
    await unsafeDb.assignment.deleteMany({})
    await unsafeDb.delegate.deleteMany({})
    await unsafeDb.registration.deleteMany({})
    signedIn = ALICE

    const orgs = await import('../src/app/api/orgs/route.ts')
    await orgs.POST(send('POST', '/api/orgs', { name: 'Delete Society', slug: ORG }), undefined)

    const organization = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: ORG } })
    organizationId = organization.id

    const conference = await unsafeDb.conference.create({
      data: { organizationId, slug: 'deletable', name: NAME, status: 'OPEN' },
    })
    conferenceId = conference.id

    // A second conference, to prove the delete is not a blast radius.
    survivorId = (
      await unsafeDb.conference.create({
        data: { organizationId, slug: 'survivor', name: 'Surviving MUN', status: 'OPEN' },
      })
    ).id

    const committee = await unsafeDb.committee.create({
      data: { conferenceId, code: 'UNSC', name: 'Security Council' },
    })
    const delegate = await unsafeDb.delegate.create({
      data: { conferenceId, fullName: 'Dara Okafor', email: 'dara@delete.test' },
    })
    await unsafeDb.assignment.create({
      data: { conferenceId, committeeId: committee.id, delegateId: delegate.id, country: 'France' },
    })
    await unsafeDb.attendanceRecord.create({
      data: { conferenceId, delegateId: delegate.id, day: new Date('2026-03-14T00:00:00.000Z') },
    })
    await unsafeDb.award.create({
      data: {
        conferenceId,
        committeeId: committee.id,
        delegateId: delegate.id,
        title: 'Best Delegate',
      },
    })

    // Something in the log about the conference, written before it is deleted.
    await unsafeDb.auditLog.create({
      data: {
        organizationId,
        conferenceId,
        action: 'committee.create',
        entityType: 'Committee',
        entityId: committee.id,
      },
    })

    const member = await unsafeDb.user.create({
      data: { authUserId: MEMBER.sub, email: MEMBER.email!, profileCompletedAt: new Date() },
    })
    await unsafeDb.membership.create({ data: { userId: member.id, organizationId, role: 'MEMBER' } })
    await unsafeDb.conferenceRole.create({
      data: { userId: member.id, conferenceId, role: 'ADMIN' },
    })
  })

  afterAll(async () => {
    await resetDatabase()
    await unsafeDb.delegate.deleteMany({})
    signedIn = null
  })

  const destroy = async (confirm: string, id = conferenceId) => {
    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/route.ts'
    )
    return route.DELETE(
      send('DELETE', `/api/orgs/${ORG}/conferences/${id}`, { confirm }),
      params({ orgSlug: ORG, conferenceId: id }),
    )
  }

  /**
   * The confirmation is a server-side rule, not a dialog.
   *
   * A disabled button is a suggestion that `curl` ignores, and this is the most
   * destructive call in the product.
   */
  it('refuses a confirmation that does not match the name', async () => {
    const response = await destroy('deletable mun')
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.details).toEqual([{ path: 'confirm', message: expect.stringContaining(NAME) }])
    expect(await unsafeDb.conference.count()).toBe(2)
  })

  it('deletes the conference and everything hanging off it', async () => {
    const response = await destroy(NAME)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ deleted: true, name: NAME })

    expect(await unsafeDb.conference.count({ where: { id: conferenceId } })).toBe(0)
    expect(await unsafeDb.committee.count({ where: { conferenceId } })).toBe(0)
    expect(await unsafeDb.delegate.count({ where: { conferenceId } })).toBe(0)
    expect(await unsafeDb.assignment.count({ where: { conferenceId } })).toBe(0)
    expect(await unsafeDb.attendanceRecord.count({ where: { conferenceId } })).toBe(0)
    expect(await unsafeDb.award.count({ where: { conferenceId } })).toBe(0)
  })

  it('leaves the organisation’s other conferences alone', async () => {
    await destroy(NAME)

    expect(await unsafeDb.conference.count({ where: { id: survivorId } })).toBe(1)
  })

  /**
   * The reason `AuditLog.conferenceId` was changed from `Cascade` to `SetNull`
   * in Stage 8.
   *
   * Under the cascade, deleting a conference took every row recording what had
   * been done to it — including the row recording the deletion. "The audit log
   * is the answer to *I deleted it by mistake*" was then false at exactly the
   * moment it was needed.
   */
  it('keeps the audit trail, detached from the conference that is gone', async () => {
    const before = await unsafeDb.auditLog.count()

    await destroy(NAME)

    const after = await unsafeDb.auditLog.count()
    expect(after).toBeGreaterThan(before)

    const deletion = await unsafeDb.auditLog.findFirstOrThrow({
      where: { action: 'conference.delete' },
    })
    expect(deletion.conferenceId).toBeNull()
    expect(deletion.organizationId).toBe(organizationId)
    // What was destroyed, which is the part worth reading a year later.
    expect(deletion.payloadBefore).toMatchObject({
      name: NAME,
      committees: 1,
      delegates: 1,
    })

    // And the rows written before the deletion survived it.
    const earlier = await unsafeDb.auditLog.findFirst({ where: { action: 'committee.create' } })
    expect(earlier).not.toBeNull()
    expect(earlier?.conferenceId).toBeNull()
  })

  it('is closed to a conference ADMIN who is only an organisation MEMBER', async () => {
    signedIn = MEMBER
    const response = await destroy(NAME)

    // Deleting a conference is the same power as creating one, and the
    // conference roles cannot express it.
    expect(response.status).toBe(403)
    expect(await unsafeDb.conference.count({ where: { id: conferenceId } })).toBe(1)
  })

  it('is 404 for a conference in another organisation', async () => {
    const other = await unsafeDb.organization.create({
      data: { slug: 'zz-delete-other', name: 'Other Society' },
    })
    const theirs = await unsafeDb.conference.create({
      data: { organizationId: other.id, slug: 'theirs', name: 'Their MUN' },
    })

    const response = await destroy('Their MUN', theirs.id)

    expect(response.status).toBe(404)
    expect(await unsafeDb.conference.count({ where: { id: theirs.id } })).toBe(1)
  })

  it('archives instead, reversibly, when that is what was wanted', async () => {
    const route = await import(
      '../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/route.ts'
    )

    await route.PATCH(
      send('PATCH', `/api/orgs/${ORG}/conferences/${conferenceId}`, { status: 'ARCHIVED' }),
      params({ orgSlug: ORG, conferenceId }),
    )
    expect(
      (await unsafeDb.conference.findUniqueOrThrow({ where: { id: conferenceId } })).status,
    ).toBe('ARCHIVED')

    await route.PATCH(
      send('PATCH', `/api/orgs/${ORG}/conferences/${conferenceId}`, { status: 'CLOSED' }),
      params({ orgSlug: ORG, conferenceId }),
    )
    const reopened = await unsafeDb.conference.findUniqueOrThrow({ where: { id: conferenceId } })

    expect(reopened.status).toBe('CLOSED')
    // Nothing was lost while it was archived.
    expect(await unsafeDb.delegate.count({ where: { conferenceId } })).toBe(1)
  })
})
