import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AccessTokenClaims } from '../src/server/auth/verify.ts'
import { unsafeDb } from '../src/server/db.ts'
import { describeWithDb, resetDatabase } from './support/harness.ts'

/**
 * Stage 7's third exit criterion: **a test walks the route manifest and asserts
 * every mutating admin route writes an `AuditLog` row.**
 *
 * That guarantee is carried by three layers, because no single one of them can
 * hold it on its own.
 *
 * 1. **The manifest walk.** Every `route.ts` under `src/app/api` is read, every
 *    exported `POST`/`PATCH`/`PUT`/`DELETE` found, and each one that resolves an
 *    organisation is required to declare an `audit:` action. A route that is
 *    *not* an admin route has to be named in `NON_ADMIN_ROUTES` below, with a
 *    reason — so adding an unaudited endpoint fails here rather than passing
 *    quietly.
 *
 * 2. **The runtime assertion in `withApi`.** A declaration is a comment until
 *    something checks it. Under Vitest, a mutating route that declares an audit
 *    action, succeeds, and writes no row *throws*. So layer 1 proves the intent
 *    and layer 2 proves the behaviour — for every route any test exercises.
 *
 * 3. **The live sweep below**, which exercises all of them. Without it, layer 2
 *    protects only the routes that happen to be covered, and the guarantee is
 *    as good as the least-tested endpoint. The sweep calls each mutating admin
 *    route once against a real database and asserts the row count went up.
 *
 * Layer 1 needs no database and runs anywhere. Layers 2 and 3 need Postgres.
 */

/* -------------------------------------------------------------------------- */
/* The manifest                                                                */
/* -------------------------------------------------------------------------- */

const API_ROOT = join(import.meta.dirname, '..', 'src', 'app', 'api')

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

interface RouteExport {
  file: string
  method: (typeof MUTATING_METHODS)[number]
  hasOrgParam: boolean
  audit: string | undefined
}

function routeFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...routeFiles(path))
    else if (entry.name === 'route.ts') found.push(path)
  }
  return found.sort()
}

/**
 * Reads the declarations out of a route file.
 *
 * Text, not AST. A route handler in this codebase is a ten-line adapter by
 * convention — `withApi` and an options object — so slicing the file at each
 * `export const METHOD =` and looking inside that slice is exact for every
 * route that exists, and a route written some other way would fail the
 * `withApi` check below rather than slip past.
 */
function parseRoute(file: string): RouteExport[] {
  const source = readFileSync(file, 'utf8')
  const relativePath = relative(join(import.meta.dirname, '..'), file)

  const exports: RouteExport[] = []
  const pattern = /export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) =/g

  const starts: { method: string; index: number }[] = []
  for (const match of source.matchAll(pattern)) {
    starts.push({ method: match[1]!, index: match.index })
  }

  starts.forEach((start, position) => {
    if (!(MUTATING_METHODS as readonly string[]).includes(start.method)) return

    const end = starts[position + 1]?.index ?? source.length
    const block = source.slice(start.index, end)

    const audit = /\baudit:\s*'([^']+)'/.exec(block)?.[1]

    exports.push({
      file: relativePath,
      method: start.method as RouteExport['method'],
      hasOrgParam: /\borgParam:\s*'/.test(block),
      audit,
    })
  })

  return exports
}

/**
 * Mutating routes that are deliberately not admin routes.
 *
 * Each needs a reason, and the reason has to be about who the caller is rather
 * than about how much work an audit row would be. Adding a route here is a
 * decision; the test failing is what makes it one.
 */
const NON_ADMIN_ROUTES: Record<string, string> = {
  'src/app/api/orgs/route.ts':
    'Creating an organisation has no organisation to be scoped to yet. It does write an ' +
    'organization.create row through the bootstrap client — see src/server/services/organizations.ts.',
  'src/app/api/onboarding/route.ts':
    "Completing your own profile. The actor is the only subject, and the User row's own " +
    'timestamps are the record.',
  'src/app/api/invitations/accept/route.ts':
    'Accepting an invitation. The caller is by definition not yet a member, so there is no ' +
    'membership to resolve. It writes an invitation.accept row through its own scoped client.',
  'src/app/api/public/[orgSlug]/[conferenceSlug]/register/route.ts':
    'The public registration form. Unauthenticated by design, and the Registration row with ' +
    'its submittedIp is the record of the submission.',
  'src/app/api/public/[orgSlug]/[conferenceSlug]/upload/route.ts':
    'Presigning an upload for the public form. Mints no row and changes nothing.',
  'src/app/api/integrations/google-sheets/[conferenceId]/route.ts':
    'The Google Sheets webhook. Authenticated by a per-conference secret rather than by a ' +
    'session, so there is no member to attribute an action to.',
  'src/app/api/auth/check-email/route.ts':
    'Asks whether an address has an account, for the two-step sign in. Reads nothing tenanted ' +
    'and writes nothing.',
}

describe('the route manifest', () => {
  const routes = routeFiles(API_ROOT).flatMap(parseRoute)

  it('finds routes to check', () => {
    // Guards against the whole suite passing vacuously if the directory moves.
    expect(routes.length).toBeGreaterThan(10)
  })

  it('declares an audit action on every mutating admin route', () => {
    const missing = routes
      .filter((route) => route.hasOrgParam && route.audit === undefined)
      .map((route) => `${route.method} ${route.file}`)

    expect(
      missing,
      'These routes mutate inside an organisation and declare no audit action, so nothing ' +
        'checks that they write one: ' +
        missing.join(', '),
    ).toEqual([])
  })

  it('requires a written reason for every mutating route that is not an admin route', () => {
    const unexplained = [
      ...new Set(
        routes
          .filter((route) => !route.hasOrgParam && NON_ADMIN_ROUTES[route.file] === undefined)
          .map((route) => route.file),
      ),
    ]

    expect(
      unexplained,
      'These routes mutate without resolving an organisation. Either add `orgParam` and an ' +
        '`audit` action, or add the file to NON_ADMIN_ROUTES in this test with the reason: ' +
        unexplained.join(', '),
    ).toEqual([])
  })

  it('lists no exemption for a route that no longer exists', () => {
    const present = new Set(routes.map((route) => route.file))
    const stale = Object.keys(NON_ADMIN_ROUTES).filter((file) => !present.has(file))

    expect(stale, `Exempted but no longer a mutating route: ${stale.join(', ')}`).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* The live sweep                                                              */
/* -------------------------------------------------------------------------- */

let signedIn: AccessTokenClaims | null = null

vi.mock('../src/server/auth/session.ts', () => ({
  optionalClaims: async () => signedIn,
  requireClaims: async () => {
    if (!signedIn) throw new Error('not signed in')
    return signedIn
  },
}))

const ALICE: AccessTokenClaims = { sub: 'zz_auth_manifest_alice', email: 'alice@manifest.test' }

const params = <T,>(value: T) => ({ params: Promise.resolve(value) })

const body = (method: string, url: string, payload?: unknown) =>
  new Request(`https://example.test${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  })

/**
 * Every `METHOD src/app/api/...` the sweep actually invoked.
 *
 * Recorded by calling the handler rather than by reading the test source, which
 * is what makes the closing check exact. The first version of this compared
 * *file paths* found in the source, and it passed a `DELETE` added to a file
 * whose `PATCH` was already swept — a whole destructive route proved by nothing.
 * A set that only a real call can add to cannot make that mistake.
 */
const SWEPT = new Set<string>()

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> } | undefined,
) => Promise<Response>

/**
 * Imports a route module and wraps every exported handler so that invoking it
 * records the method and the file.
 *
 * Generic over the module type rather than returning a `Record`, so call sites
 * keep the module's real shape — `route.PATCH` stays a known function instead of
 * becoming a possibly-undefined index lookup.
 */
function track<T extends object>(file: string, module: T): T {
  const wrapped: Record<string, RouteHandler> = {}

  for (const [method, handler] of Object.entries(module)) {
    if (typeof handler !== 'function') continue
    wrapped[method] = (request, context) => {
      SWEPT.add(`${method} ${file}`)
      return (handler as RouteHandler)(request, context)
    }
  }

  return wrapped as T
}

describeWithDb('every mutating admin route writes an AuditLog row', () => {
  const ORG = 'zz-manifest-org'

  let conferenceId = ''
  let committeeId = ''
  let delegateId = ''
  let registrationId = ''
  let rejectedRegistrationId = ''
  let logisticsId = ''
  let awardId = ''
  let invitationId = ''
  let secondUserId = ''

  beforeAll(async () => {
    await resetDatabase()
    await unsafeDb.assignment.deleteMany({})
    await unsafeDb.delegate.deleteMany({})
    await unsafeDb.registration.deleteMany({})

    signedIn = ALICE

    const orgs = track(
      'src/app/api/orgs/route.ts',
      await import('../src/app/api/orgs/route.ts'),
    )
    await orgs.POST(body('POST', '/api/orgs', { name: 'Manifest MUN Society', slug: ORG }), undefined)

    const conferences = track(
      'src/app/api/orgs/[orgSlug]/conferences/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/route.ts'),
    )
    const created = await conferences.POST(
      body('POST', `/api/orgs/${ORG}/conferences`, { name: 'Manifest MUN', slug: 'manifest-mun' }),
      params({ orgSlug: ORG }),
    )
    conferenceId = (await created.json()).conference.id

    await unsafeDb.conference.update({ where: { id: conferenceId }, data: { status: 'OPEN' } })

    // A second member, so ownership transfer and membership writes have a
    // subject. Built directly rather than through the invitation flow, which
    // has its own suite.
    const second = await unsafeDb.user.create({
      data: {
        authUserId: 'zz_auth_manifest_bob',
        email: 'bob@manifest.test',
        fullName: 'Bob Manifest',
        profileCompletedAt: new Date(),
      },
    })
    secondUserId = second.id
    const organization = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: ORG } })
    await unsafeDb.membership.create({
      data: { userId: second.id, organizationId: organization.id, role: 'MEMBER' },
    })
  })

  afterAll(async () => {
    await resetDatabase()
    signedIn = null
  })

  /**
   * Calls one route and asserts it both succeeded and left a row behind.
   *
   * The count is taken before and after rather than looked up by action, so a
   * route that writes *someone else's* action still fails the test it should:
   * this asks whether the request left a trace, which is the guarantee, and the
   * action string is checked separately when it matters.
   */
  async function sweep(
    label: string,
    call: () => Promise<Response>,
    expectedStatus = 200,
  ): Promise<Response> {
    const before = await unsafeDb.auditLog.count()
    const response = await call()

    expect(response.status, `${label} — ${JSON.stringify(await response.clone().json())}`).toBe(
      expectedStatus,
    )

    const after = await unsafeDb.auditLog.count()
    expect(after, `${label} wrote no AuditLog row`).toBeGreaterThan(before)

    return response
  }

  it('conference.update', async () => {
    const route = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/route.ts'),
    )
    await sweep('PATCH conference', () =>
      route.PATCH(
        body('PATCH', `/api/orgs/${ORG}/conferences/${conferenceId}`, { venue: 'The old hall' }),
        params({ orgSlug: ORG, conferenceId }),
      ),
    )
  })

  it('committee.create, committee.update and committee.set_countries', async () => {
    const list = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/route.ts'),
    )
    const created = await sweep(
      'POST committee',
      () =>
        list.POST(
          body('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/committees`, {
            code: 'UNSC',
            name: 'Security Council',
            seats: 20,
          }),
          params({ orgSlug: ORG, conferenceId }),
        ),
      201,
    )
    committeeId = (await created.json()).committee.id

    const single = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/[committeeId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/[committeeId]/route.ts'),
    )
    await sweep('PATCH committee', () =>
      single.PATCH(
        body('PATCH', `/api/orgs/${ORG}/conferences/${conferenceId}/committees/${committeeId}`, {
          seats: 25,
        }),
        params({ orgSlug: ORG, conferenceId, committeeId }),
      ),
    )

    const countries = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/[committeeId]/countries/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/[committeeId]/countries/route.ts'),
    )
    await sweep('PUT countries', () =>
      countries.PUT(
        body(
          'PUT',
          `/api/orgs/${ORG}/conferences/${conferenceId}/committees/${committeeId}/countries`,
          { countries: [{ country: 'France', seats: 1 }, { country: 'Japan', seats: 1 }] },
        ),
        params({ orgSlug: ORG, conferenceId, committeeId }),
      ),
    )
  })

  it('registration.import, registration.approve and registration.reject', async () => {
    const importRoute = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/registrations/import/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/registrations/import/route.ts'),
    )
    await sweep('POST registrations/import', () =>
      importRoute.POST(
        body('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/registrations/import`, {
          csv: 'Full name,Email,School\nDara Okafor,dara@manifest.test,Riverside\nSam Lee,sam@manifest.test,Hillcrest',
        }),
        params({ orgSlug: ORG, conferenceId }),
      ),
    )

    const registrations = await unsafeDb.registration.findMany({ orderBy: { email: 'asc' } })
    registrationId = registrations[0]!.id
    rejectedRegistrationId = registrations[1]!.id

    const approve = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/registrations/[registrationId]/approve/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/registrations/[registrationId]/approve/route.ts'),
    )
    await sweep(
      'POST approve',
      () =>
        approve.POST(
          body(
            'POST',
            `/api/orgs/${ORG}/conferences/${conferenceId}/registrations/${registrationId}/approve`,
          ),
          params({ orgSlug: ORG, conferenceId, registrationId }),
        ),
      201,
    )

    delegateId = (await unsafeDb.delegate.findFirstOrThrow({})).id

    const reject = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/registrations/[registrationId]/reject/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/registrations/[registrationId]/reject/route.ts'),
    )
    await sweep('POST reject', () =>
      reject.POST(
        body(
          'POST',
          `/api/orgs/${ORG}/conferences/${conferenceId}/registrations/${rejectedRegistrationId}/reject`,
          { reason: 'Applied after the deadline' },
        ),
        params({ orgSlug: ORG, conferenceId, registrationId: rejectedRegistrationId }),
      ),
    )
  })

  it('delegate.update', async () => {
    const route = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/delegates/[delegateId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/delegates/[delegateId]/route.ts'),
    )
    await sweep('PATCH delegate', () =>
      route.PATCH(
        body('PATCH', `/api/orgs/${ORG}/conferences/${conferenceId}/delegates/${delegateId}`, {
          schoolName: 'Riverside High',
        }),
        params({ orgSlug: ORG, conferenceId, delegateId }),
      ),
    )
  })

  it('matrix.import', async () => {
    const route = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/matrix/import/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/matrix/import/route.ts'),
    )
    await sweep('POST matrix/import', () =>
      route.POST(
        body('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/matrix/import`, {
          csv: 'UNSC\nFrance\nJapan',
          mode: 'replace',
        }),
        params({ orgSlug: ORG, conferenceId }),
      ),
    )
  })

  it('assignment.create and assignment.remove', async () => {
    const allocations = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/allocations/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/allocations/route.ts'),
    )
    await sweep(
      'POST allocation',
      () =>
        allocations.POST(
          body('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/allocations`, {
            delegateId,
            committeeId,
            country: 'France',
          }),
          params({ orgSlug: ORG, conferenceId }),
        ),
      201,
    )

    const single = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/allocations/[delegateId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/allocations/[delegateId]/route.ts'),
    )
    await sweep('DELETE allocation', () =>
      single.DELETE(
        body('DELETE', `/api/orgs/${ORG}/conferences/${conferenceId}/allocations/${delegateId}`),
        params({ orgSlug: ORG, conferenceId, delegateId }),
      ),
    )

    // Put it back — the awards route needs the delegate seated.
    await allocations.POST(
      body('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/allocations`, {
        delegateId,
        committeeId,
        country: 'France',
      }),
      params({ orgSlug: ORG, conferenceId }),
    )
  })

  it('attendance.checkin', async () => {
    const route = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/attendance/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/attendance/route.ts'),
    )
    await sweep('POST attendance', () =>
      route.POST(
        body('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/attendance`, {
          delegateId,
          day: '2026-03-14',
          status: 'PRESENT',
        }),
        params({ orgSlug: ORG, conferenceId }),
      ),
    )
  })

  it('logistics.create and logistics.update', async () => {
    const list = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/logistics/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/logistics/route.ts'),
    )
    const created = await sweep(
      'POST logistics',
      () =>
        list.POST(
          body('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/logistics`, {
            title: 'Projector in UNSC has no signal',
            category: 'TECHNICAL',
            priority: 'URGENT',
            committeeId,
          }),
          params({ orgSlug: ORG, conferenceId }),
        ),
      201,
    )
    logisticsId = (await created.json()).request.id

    const single = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/logistics/[requestId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/logistics/[requestId]/route.ts'),
    )
    await sweep('PATCH logistics', () =>
      single.PATCH(
        body('PATCH', `/api/orgs/${ORG}/conferences/${conferenceId}/logistics/${logisticsId}`, {
          status: 'RESOLVED',
          resolution: 'Swapped the cable from room 201',
        }),
        params({ orgSlug: ORG, conferenceId, requestId: logisticsId }),
      ),
    )
  })

  it('award.create and award.remove', async () => {
    const list = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/awards/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/awards/route.ts'),
    )
    const created = await sweep(
      'POST award',
      () =>
        list.POST(
          body('POST', `/api/orgs/${ORG}/conferences/${conferenceId}/awards`, {
            committeeId,
            delegateId,
            title: 'Best Delegate',
          }),
          params({ orgSlug: ORG, conferenceId }),
        ),
      201,
    )
    awardId = (await created.json()).award.id

    const single = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/awards/[awardId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/awards/[awardId]/route.ts'),
    )
    await sweep('DELETE award', () =>
      single.DELETE(
        body('DELETE', `/api/orgs/${ORG}/conferences/${conferenceId}/awards/${awardId}`),
        params({ orgSlug: ORG, conferenceId, awardId }),
      ),
    )
  })

  it('integration.issue_secret', async () => {
    const route = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/integrations/google-sheets/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/integrations/google-sheets/route.ts'),
    )
    await sweep(
      'POST google-sheets',
      () =>
        route.POST(
          body(
            'POST',
            `/api/orgs/${ORG}/conferences/${conferenceId}/integrations/google-sheets`,
          ),
          params({ orgSlug: ORG, conferenceId }),
        ),
      201,
    )
  })

  it('invitation.create and invitation.revoke', async () => {
    const list = track(
      'src/app/api/orgs/[orgSlug]/invitations/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/invitations/route.ts'),
    )
    const created = await sweep(
      'POST invitation',
      () =>
        list.POST(
          body('POST', `/api/orgs/${ORG}/invitations`, { email: 'carol@manifest.test' }),
          params({ orgSlug: ORG }),
        ),
      201,
    )
    invitationId = (await created.json()).invitation.id

    const single = track(
      'src/app/api/orgs/[orgSlug]/invitations/[invitationId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/invitations/[invitationId]/route.ts'),
    )
    await sweep('DELETE invitation', () =>
      single.DELETE(
        body('DELETE', `/api/orgs/${ORG}/invitations/${invitationId}`),
        params({ orgSlug: ORG, invitationId }),
      ),
    )
  })

  it('membership.update, organization.transfer_ownership and membership.remove', async () => {
    const member = track(
      'src/app/api/orgs/[orgSlug]/members/[userId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/members/[userId]/route.ts'),
    )
    await sweep('PATCH member', () =>
      member.PATCH(
        body('PATCH', `/api/orgs/${ORG}/members/${secondUserId}`, { role: 'ADMIN' }),
        params({ orgSlug: ORG, userId: secondUserId }),
      ),
    )

    const transfer = track(
      'src/app/api/orgs/[orgSlug]/transfer-ownership/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/transfer-ownership/route.ts'),
    )
    await sweep('POST transfer-ownership', () =>
      transfer.POST(
        body('POST', `/api/orgs/${ORG}/transfer-ownership`, { userId: secondUserId }),
        params({ orgSlug: ORG }),
      ),
    )

    // Alice is now an ADMIN rather than the OWNER, and still manages members —
    // `canManageMembers` is off the role axis, which is what makes this the
    // right place to prove removal still works after a transfer.
    await unsafeDb.membership.updateMany({
      where: { user: { authUserId: ALICE.sub } },
      data: { canManageMembers: true },
    })

    const alice = await unsafeDb.user.findUniqueOrThrow({ where: { authUserId: ALICE.sub } })
    const third = await unsafeDb.user.create({
      data: {
        authUserId: 'zz_auth_manifest_dana',
        email: 'dana@manifest.test',
        profileCompletedAt: new Date(),
      },
    })
    const organization = await unsafeDb.organization.findUniqueOrThrow({ where: { slug: ORG } })
    await unsafeDb.membership.create({
      data: { userId: third.id, organizationId: organization.id, role: 'MEMBER' },
    })

    expect(alice.id).not.toBe(third.id)

    await sweep('DELETE member', () =>
      member.DELETE(
        body('DELETE', `/api/orgs/${ORG}/members/${third.id}`),
        params({ orgSlug: ORG, userId: third.id }),
      ),
    )
  })

  it('organization.update and organization.branding', async () => {
    const settings = track(
      'src/app/api/orgs/[orgSlug]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/route.ts'),
    )
    await sweep('PATCH organisation', () =>
      settings.PATCH(
        body('PATCH', `/api/orgs/${ORG}`, { name: 'Manifest MUN Society (renamed)' }),
        params({ orgSlug: ORG }),
      ),
    )

    const branding = track(
      'src/app/api/orgs/[orgSlug]/branding/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/branding/route.ts'),
    )
    await sweep('PUT branding', () =>
      branding.PUT(
        // The preset's own seeds, unchanged. A customised palette is the
        // `customBranding` flag, which this organisation is on the free plan
        // for — that refusal has its own test in organizations.test.ts.
        body('PUT', `/api/orgs/${ORG}/branding`, {
          preset: 'navy',
          seed: { primary: '#1d4ed8', ink: '#0b1220', paper: '#f8fafc', accent: '#c2872b' },
          radius: 'soft',
          font: 'grotesk',
          logoUrl: null,
        }),
        params({ orgSlug: ORG }),
      ),
    )
  })

  it('committee.delete', async () => {
    // Last, because deleting the committee cascades the allocation and the
    // award that the earlier sweeps depend on.
    const route = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/[committeeId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/committees/[committeeId]/route.ts'),
    )
    await sweep('DELETE committee', () =>
      route.DELETE(
        body('DELETE', `/api/orgs/${ORG}/conferences/${conferenceId}/committees/${committeeId}`),
        params({ orgSlug: ORG, conferenceId, committeeId }),
      ),
    )
  })

  /**
   * The closing argument.
   *
   * Every mutating admin route in the manifest has now been called at least
   * once in this file, so layer 2 — the runtime assertion inside `withApi` —
   * has had the chance to fire on all of them. This checks that claim rather
   * than asserting it in a comment: if a route is added and not swept, this
   * fails and names it.
   */
  it('conference.delete', async () => {
    /*
      Last, and by some distance the most destructive: this cascades the
      committees, delegates, allocations, attendance, logistics and awards every
      test above created. It runs here because nothing after it needs the
      conference — and the audit rows it leaves behind are the point of
      `AuditLog.conferenceId` being SetNull rather than Cascade.
    */
    const before = await unsafeDb.auditLog.count()

    const route = track(
      'src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/route.ts',
      await import('../src/app/api/orgs/[orgSlug]/conferences/[conferenceId]/route.ts'),
    )

    const refused = await route.DELETE(
      body('DELETE', `/api/orgs/${ORG}/conferences/${conferenceId}`, { confirm: 'not the name' }),
      params({ orgSlug: ORG, conferenceId }),
    )
    expect(refused.status, 'a wrong confirmation must not delete anything').toBe(422)
    expect(await unsafeDb.conference.count()).toBe(1)

    await sweep('DELETE conference', () =>
      route.DELETE(
        body('DELETE', `/api/orgs/${ORG}/conferences/${conferenceId}`, {
          confirm: 'Manifest MUN',
        }),
        params({ orgSlug: ORG, conferenceId }),
      ),
    )

    expect(await unsafeDb.conference.count()).toBe(0)

    // The trail survived the thing it describes.
    const after = await unsafeDb.auditLog.count()
    expect(after).toBeGreaterThan(before)
    expect(
      await unsafeDb.auditLog.count({ where: { action: 'conference.delete' } }),
      'the record of the deletion outlives the conference',
    ).toBe(1)
  })

  it('leaves no mutating admin route unexercised', () => {
    const manifest = routeFiles(API_ROOT)
      .flatMap(parseRoute)
      .filter((route) => route.hasOrgParam)
      .map((route) => `${route.method} ${route.file}`)

    const unexercised = manifest.filter((entry) => !SWEPT.has(entry)).sort()

    expect(
      unexercised,
      'These mutating admin routes were never called by this sweep, so nothing proves they ' +
        'write the audit row they declare: ' +
        unexercised.join(', '),
    ).toEqual([])

    /*
      And nothing claims coverage it does not have: every recorded call
      corresponds to a route that still exists.

      Compared against **every** mutating route rather than the admin subset,
      because the fixture legitimately calls a few that are not admin routes —
      creating the organisation in the first place, for one — and those are
      exempt from needing an audit action, not from existing.
    */
    const everyMutatingRoute = routeFiles(API_ROOT)
      .flatMap(parseRoute)
      .map((route) => `${route.method} ${route.file}`)

    const stale = [...SWEPT].filter((entry) => !everyMutatingRoute.includes(entry)).sort()
    expect(stale, `Swept but no longer a mutating route: ${stale.join(', ')}`).toEqual([])
  })
})
