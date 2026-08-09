import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import type { AccessTokenClaims } from '../src/server/auth/verify.ts'
import { unsafeDb } from '../src/server/db.ts'
import { describeWithDb, resetDatabase } from './support/harness.ts'

/**
 * Signed-in identity is the one thing stubbed.
 *
 * Everything else runs for real: withApi, createCtx, JIT provisioning,
 * membership resolution, the scoped Prisma client and Postgres. Token
 * verification has its own tests and needs a live Supabase project to be
 * meaningful, so faking it here buys coverage of the chain that actually
 * decides who can see what.
 */
let signedIn: AccessTokenClaims | null = null

vi.mock('../src/server/auth/session.ts', () => ({
  optionalClaims: async () => signedIn,
  requireClaims: async () => {
    if (!signedIn) throw new Error('not signed in')
    return signedIn
  },
}))

const ALICE: AccessTokenClaims = {
  sub: 'zz_auth_alice',
  email: 'alice@example.test',
  fullName: 'Alice Owner',
}
const BOB: AccessTokenClaims = {
  sub: 'zz_auth_bob',
  email: 'bob@example.test',
  fullName: 'Bob Invitee',
}

const req = (url: string, init?: RequestInit) => new Request(`https://example.test${url}`, init)
const post = (url: string, body: unknown) =>
  req(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (url: string, body: unknown) =>
  req(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

async function createOrg(name: string, slug: string) {
  const { POST } = await import('../src/app/api/orgs/route.ts')
  return POST(post('/api/orgs', { name, slug }), undefined)
}

async function getMembers(orgSlug: string) {
  const { GET } = await import('../src/app/api/orgs/[orgSlug]/members/route.ts')
  return GET(req(`/api/orgs/${orgSlug}/members`), params({ orgSlug }))
}

describeWithDb('organisations, membership and invitations', () => {
  beforeEach(async () => {
    await resetDatabase()
    signedIn = null
  })

  afterAll(async () => {
    await resetDatabase()
  })

  it('provisions a user on first sign-in and makes them owner of what they create', async () => {
    signedIn = ALICE

    const response = await createOrg('Alpha Model UN Society', 'zz-alpha')
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.organization).toMatchObject({ slug: 'zz-alpha', role: 'OWNER' })

    // The Supabase subject is stored as a plain column, never used as our id.
    const user = await unsafeDb.user.findUniqueOrThrow({ where: { authUserId: ALICE.sub } })
    expect(user.email).toBe(ALICE.email)
    expect(user.id).not.toBe(ALICE.sub)
  })

  it('answers 404, not 403, to a stranger asking about an organisation', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    signedIn = BOB
    const response = await getMembers('zz-alpha')

    // 403 would confirm that zz-alpha exists, which turns the sign-up slug
    // field into an enumeration oracle: try `harvard`, try `yale`, learn who
    // is a customer.
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found', code: 404 })
  })

  it('answers a non-existent organisation identically to one you cannot see', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    signedIn = BOB
    const missing = await getMembers('zz-does-not-exist')
    const hidden = await getMembers('zz-alpha')

    expect(await missing.json()).toEqual(await hidden.json())
    expect(missing.status).toBe(hidden.status)
  })

  it('lets an invited person in, and only then', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    // Before: 404.
    signedIn = BOB
    expect((await getMembers('zz-alpha')).status).toBe(404)

    signedIn = ALICE
    const { POST: createInvite } = await import(
      '../src/app/api/orgs/[orgSlug]/invitations/route.ts'
    )
    const inviteResponse = await createInvite(
      post('/api/orgs/zz-alpha/invitations', { email: BOB.email, orgRole: 'ADMIN' }),
      params({ orgSlug: 'zz-alpha' }),
    )
    const { token } = await inviteResponse.json()
    expect(inviteResponse.status).toBe(201)
    expect(token).toEqual(expect.any(String))

    signedIn = BOB
    const { POST: accept } = await import('../src/app/api/invitations/accept/route.ts')
    const acceptResponse = await accept(post('/api/invitations/accept', { token }), undefined)
    expect(acceptResponse.status).toBe(200)

    // After: 200, with both people in it.
    const after = await getMembers('zz-alpha')
    const body = await after.json()
    expect(after.status).toBe(200)
    expect(body.members).toHaveLength(2)
    expect(body.members.map((m: { email: string }) => m.email).sort()).toEqual([
      ALICE.email,
      BOB.email,
    ])
  })

  it('stores only the hash of an invitation token', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    const { POST: createInvite } = await import(
      '../src/app/api/orgs/[orgSlug]/invitations/route.ts'
    )
    const { token } = await (
      await createInvite(
        post('/api/orgs/zz-alpha/invitations', { email: BOB.email }),
        params({ orgSlug: 'zz-alpha' }),
      )
    ).json()

    const rows = await unsafeDb.invitation.findMany()
    expect(rows).toHaveLength(1)

    // The table cannot be read back into a working credential — the point of
    // hashing it in the first place.
    expect(JSON.stringify(rows)).not.toContain(token)
    expect(rows[0]?.tokenHash).not.toBe(token)
  })

  it('spends an invitation exactly once', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const { POST: createInvite } = await import(
      '../src/app/api/orgs/[orgSlug]/invitations/route.ts'
    )
    const { token } = await (
      await createInvite(
        post('/api/orgs/zz-alpha/invitations', { email: BOB.email }),
        params({ orgSlug: 'zz-alpha' }),
      )
    ).json()

    signedIn = BOB
    const { POST: accept } = await import('../src/app/api/invitations/accept/route.ts')
    expect((await accept(post('/api/invitations/accept', { token }), undefined)).status).toBe(200)

    const second = await accept(post('/api/invitations/accept', { token }), undefined)
    expect(second.status).toBe(404)
  })

  it('accepts an invitation forwarded to a different address', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const { POST: createInvite } = await import(
      '../src/app/api/orgs/[orgSlug]/invitations/route.ts'
    )
    const { token } = await (
      await createInvite(
        post('/api/orgs/zz-alpha/invitations', { email: 'someone-else@example.test' }),
        params({ orgSlug: 'zz-alpha' }),
      )
    ).json()

    // People forward invitations to the address they actually read. Refusing
    // would strand them with no way through; the token is the authority and
    // the email is a hint.
    signedIn = BOB
    const { POST: accept } = await import('../src/app/api/invitations/accept/route.ts')
    expect((await accept(post('/api/invitations/accept', { token }), undefined)).status).toBe(200)
  })

  it('refuses to demote the last owner', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const alice = await unsafeDb.user.findUniqueOrThrow({ where: { authUserId: ALICE.sub } })

    const { PATCH } = await import('../src/app/api/orgs/[orgSlug]/members/[userId]/route.ts')
    const response = await PATCH(
      patch(`/api/orgs/zz-alpha/members/${alice.id}`, { role: 'ADMIN' }),
      params({ orgSlug: 'zz-alpha', userId: alice.id }),
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.details).toMatchObject({ reason: 'last_owner' })

    // And it did not half-apply.
    const membership = await unsafeDb.membership.findFirstOrThrow({ where: { userId: alice.id } })
    expect(membership.role).toBe('OWNER')
  })

  it('refuses to remove the last owner', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const alice = await unsafeDb.user.findUniqueOrThrow({ where: { authUserId: ALICE.sub } })

    const { DELETE } = await import('../src/app/api/orgs/[orgSlug]/members/[userId]/route.ts')
    const response = await DELETE(
      req(`/api/orgs/zz-alpha/members/${alice.id}`, { method: 'DELETE' }),
      params({ orgSlug: 'zz-alpha', userId: alice.id }),
    )

    expect(response.status).toBe(403)
    expect(await unsafeDb.membership.count()).toBe(1)
  })

  it('does not let an admin promote themselves to owner', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const { POST: createInvite } = await import(
      '../src/app/api/orgs/[orgSlug]/invitations/route.ts'
    )
    const { token } = await (
      await createInvite(
        post('/api/orgs/zz-alpha/invitations', { email: BOB.email, orgRole: 'ADMIN' }),
        params({ orgSlug: 'zz-alpha' }),
      )
    ).json()

    signedIn = BOB
    const { POST: accept } = await import('../src/app/api/invitations/accept/route.ts')
    await accept(post('/api/invitations/accept', { token }), undefined)
    const bob = await unsafeDb.user.findUniqueOrThrow({ where: { authUserId: BOB.sub } })

    // Otherwise "admin" is just "owner with extra steps".
    const { PATCH } = await import('../src/app/api/orgs/[orgSlug]/members/[userId]/route.ts')
    const response = await PATCH(
      patch(`/api/orgs/zz-alpha/members/${bob.id}`, { role: 'OWNER' }),
      params({ orgSlug: 'zz-alpha', userId: bob.id }),
    )

    expect(response.status).toBe(403)
  })

  it('writes an audit row for every membership change', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const { POST: createInvite } = await import(
      '../src/app/api/orgs/[orgSlug]/invitations/route.ts'
    )
    const { token } = await (
      await createInvite(
        post('/api/orgs/zz-alpha/invitations', { email: BOB.email }),
        params({ orgSlug: 'zz-alpha' }),
      )
    ).json()

    signedIn = BOB
    const { POST: accept } = await import('../src/app/api/invitations/accept/route.ts')
    await accept(post('/api/invitations/accept', { token }), undefined)

    const actions = (await unsafeDb.auditLog.findMany({ select: { action: true } })).map(
      (row) => row.action,
    )

    expect(actions).toEqual(
      expect.arrayContaining(['organization.create', 'invitation.create', 'invitation.accept']),
    )
  })

  it('keeps the invitation token out of the audit trail', async () => {
    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')
    const { POST: createInvite } = await import(
      '../src/app/api/orgs/[orgSlug]/invitations/route.ts'
    )
    const { token } = await (
      await createInvite(
        post('/api/orgs/zz-alpha/invitations', { email: BOB.email }),
        params({ orgSlug: 'zz-alpha' }),
      )
    ).json()

    const rows = await unsafeDb.auditLog.findMany()
    const serialised = JSON.stringify(rows)

    expect(serialised).not.toContain(token)
    // An audit table is read by more people than the table it describes, and a
    // hash is still a lookup key.
    expect(serialised).not.toContain('tokenHash')
  })

  it('refuses an invitation naming another organisation\'s conference', async () => {
    signedIn = BOB
    await createOrg('Beta Model UN Society', 'zz-beta')
    const beta = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: 'zz-beta' } })
    const betaConference = await unsafeDb.conference.create({
      data: { organizationId: beta.id, slug: 'mun-x', name: 'Beta MUN X' },
    })

    signedIn = ALICE
    await createOrg('Alpha Model UN Society', 'zz-alpha')

    const { POST: createInvite } = await import(
      '../src/app/api/orgs/[orgSlug]/invitations/route.ts'
    )
    const response = await createInvite(
      post('/api/orgs/zz-alpha/invitations', {
        email: 'carol@example.test',
        conferenceGrants: [{ conferenceId: betaConference.id, role: 'ADMIN' }],
      }),
      params({ orgSlug: 'zz-alpha' }),
    )

    // conferenceGrants is JSON on a row. Without this check, accepting would
    // hand out a role inside a tenant the inviter has no access to.
    expect(response.status).toBe(400)
  })
})
