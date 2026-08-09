import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import type { AccessTokenClaims } from '../src/server/auth/verify.ts'
import { unsafeDb } from '../src/server/db.ts'
import { PRESET_SEEDS } from '../src/lib/theme/schema.ts'
import { describeWithDb, resetDatabase } from './support/harness.ts'

let signedIn: AccessTokenClaims | null = null

vi.mock('../src/server/auth/session.ts', () => ({
  optionalClaims: async () => signedIn,
  requireClaims: async () => {
    if (!signedIn) throw new Error('not signed in')
    return signedIn
  },
}))

const ALICE: AccessTokenClaims = { sub: 'zz_auth_set_alice', email: 'alice@settings.test' }
const MEMBER: AccessTokenClaims = { sub: 'zz_auth_set_member', email: 'member@settings.test' }

const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

const send = (method: string, url: string, payload?: unknown) =>
  new Request(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })

const NAVY = { preset: 'navy' as const, radius: 'soft' as const, font: 'grotesk' as const, logoUrl: null }

describeWithDb('organisation settings', () => {
  const ORG = 'zz-settings-org'
  let organizationId = ''
  let memberUserId = ''

  beforeEach(async () => {
    await resetDatabase()
    signedIn = ALICE

    const orgs = await import('../src/app/api/orgs/route.ts')
    await orgs.POST(send('POST', '/api/orgs', { name: 'Settings Society', slug: ORG }), undefined)

    const organization = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: ORG } })
    organizationId = organization.id

    const member = await unsafeDb.user.create({
      data: { authUserId: MEMBER.sub, email: MEMBER.email!, profileCompletedAt: new Date() },
    })
    memberUserId = member.id
    await unsafeDb.membership.create({
      data: { userId: member.id, organizationId, role: 'MEMBER' },
    })
  })

  afterAll(async () => {
    await resetDatabase()
    signedIn = null
  })

  const patch = async (payload: unknown, slug = ORG) => {
    const route = await import('../src/app/api/orgs/[orgSlug]/route.ts')
    return route.PATCH(send('PATCH', `/api/orgs/${slug}`, payload), params({ orgSlug: slug }))
  }

  const putBranding = async (payload: unknown) => {
    const route = await import('../src/app/api/orgs/[orgSlug]/branding/route.ts')
    return route.PUT(send('PUT', `/api/orgs/${ORG}/branding`, payload), params({ orgSlug: ORG }))
  }

  it('renames an organisation', async () => {
    const response = await patch({ name: 'Renamed Society' })

    expect(response.status).toBe(200)
    expect((await response.json()).organization.name).toBe('Renamed Society')
  })

  it('moves the address, and records both values so the old one is recoverable', async () => {
    const response = await patch({ slug: 'zz-settings-moved' })

    expect(response.status).toBe(200)
    expect(
      await unsafeDb.organization.count({ where: { slug: 'zz-settings-moved' } }),
    ).toBe(1)

    // Every public registration link the organisation gave out has just moved,
    // so the log has to hold the address they moved from.
    const audit = await unsafeDb.auditLog.findFirstOrThrow({
      where: { action: 'organization.update' },
    })
    expect((audit.payloadBefore as { slug: string }).slug).toBe(ORG)
    expect((audit.payloadAfter as { slug: string }).slug).toBe('zz-settings-moved')
  })

  it('refuses an address another organisation already holds', async () => {
    await unsafeDb.organization.create({ data: { slug: 'zz-settings-taken', name: 'Someone Else' } })

    const response = await patch({ slug: 'zz-settings-taken' })

    expect(response.status).toBe(409)
    expect((await unsafeDb.organization.findUniqueOrThrow({ where: { id: organizationId } })).slug).toBe(
      ORG,
    )
  })

  it('refuses a reserved address', async () => {
    const response = await patch({ slug: 'settings' })
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.details).toEqual([{ path: 'slug', message: expect.stringContaining('reserved') }])
  })

  it('is closed to a plain member', async () => {
    signedIn = MEMBER
    const response = await patch({ name: 'Not allowed' })

    expect(response.status).toBe(403)
    expect(memberUserId).not.toBe('')
  })

  it('is 404, not 403, for somebody who is not a member at all', async () => {
    signedIn = { sub: 'zz_auth_set_stranger', email: 'stranger@settings.test' }
    const response = await patch({ name: 'Not allowed' })

    // Byte-identical to an organisation that never existed.
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found', code: 404 })
  })

  /* ---------------------------------------------------------------------- */

  it('saves a preset on the free plan', async () => {
    const response = await putBranding({ ...NAVY, seed: PRESET_SEEDS.navy })

    expect(response.status).toBe(200)
    const saved = await unsafeDb.organization.findUniqueOrThrow({ where: { id: organizationId } })
    expect((saved.defaultTheme as { preset: string }).preset).toBe('navy')
  })

  /**
   * `customBranding` sat in the plan table from Stage 1 with nothing reading it,
   * which made it a claim the product did not keep. Choosing a preset is not a
   * custom brand; changing one of its colours is.
   */
  it('refuses a customised palette on a plan without custom branding', async () => {
    const response = await putBranding({
      ...NAVY,
      seed: { ...PRESET_SEEDS.navy, primary: '#ff0000' },
    })
    const body = await response.json()

    // 403 and not 402: there is nothing the caller can pay.
    expect(response.status).toBe(403)
    expect(body.details).toMatchObject({ limit: 'customBranding', planKey: 'free' })
    expect(
      await unsafeDb.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    ).toMatchObject({ defaultTheme: null })
  })

  it('allows it once the limit is lifted by a row update', async () => {
    // `planLimits` is the upgrade flow. No deploy, no Stripe.
    await unsafeDb.organization.update({
      where: { id: organizationId },
      data: { planLimits: { customBranding: true } },
    })

    const response = await putBranding({
      ...NAVY,
      seed: { ...PRESET_SEEDS.navy, primary: '#ff0000' },
    })

    expect(response.status).toBe(200)
    const saved = await unsafeDb.organization.findUniqueOrThrow({ where: { id: organizationId } })
    expect((saved.defaultTheme as { seed: { primary: string } }).seed.primary).toBe('#ff0000')
  })

  it('answers 422 for a colour that is not a colour', async () => {
    const response = await putBranding({
      ...NAVY,
      seed: { ...PRESET_SEEDS.navy, primary: 'rebeccapurple' },
    })
    const body = await response.json()

    // Not a ZodError escaping as a 500 — the error contract, with a path.
    expect(response.status).toBe(422)
    expect(body.details[0].path).toBe('seed.primary')
  })

  it('stores no arbitrary CSS, whatever is sent', async () => {
    const response = await putBranding({
      ...NAVY,
      seed: PRESET_SEEDS.navy,
      // Unknown keys are stripped by the schema rather than persisted, so a
      // theme column can never become a stylesheet somebody typed.
      injected: '</style><script>alert(1)</script>',
    })

    expect(response.status).toBe(200)
    const saved = await unsafeDb.organization.findUniqueOrThrow({ where: { id: organizationId } })
    expect(JSON.stringify(saved.defaultTheme)).not.toContain('script')
  })

  it('reports usage from the plan, for the panel', async () => {
    const route = await import('../src/app/api/orgs/[orgSlug]/route.ts')
    const body = await (
      await route.GET(send('GET', `/api/orgs/${ORG}`), params({ orgSlug: ORG }))
    ).json()

    expect(body.usage).toMatchObject({
      planKey: 'free',
      planLabel: 'Free',
      conferences: { current: 0, max: 2 },
      members: { current: 2, max: 5 },
      customBranding: false,
    })
  })
})
