/**
 * The request context.
 *
 * `createCtx` is the only supported way to get a database handle. Everything a
 * service needs arrives on this object, already scoped, so a service function
 * cannot accidentally query across tenants and cannot reach a `Request`.
 *
 * Services take `ctx` and return values. Route handlers translate. That
 * separation is what lets a Server Component call a service directly and get
 * the same authorization as an HTTP caller — a check that lives only in a
 * route handler is a check that does not run for the first paint.
 */

import type { ConferenceRoleName } from '@/generated/prisma/enums.ts'
import { createAuditRecorder, type AuditContext, type AuditRecorder } from './audit.ts'
import { scope, type ScopedClient } from './db.ts'
import { ApiError } from './errors.ts'
import { getOrCreateUser, type AppUser } from './auth/provisioning.ts'
import { optionalClaims } from './auth/session.ts'
import {
  requireMembership,
  resolveConferenceRole,
  type ResolvedMembership,
} from './auth/membership.ts'

export interface Ctx {
  user: AppUser | null
  membership: ResolvedMembership | null
  organizationId?: string
  conferenceId?: string
  conferenceRole?: ConferenceRoleName
  /** Already scoped. There is no unscoped handle on this object, on purpose. */
  db: ScopedClient
  audit: AuditRecorder
}

/**
 * Three states, not two, because "public" means two different things.
 *
 * `optional` still looks the caller up — the invitation preview needs to say
 * "you are signed in as X" to someone who may or may not be. `none` skips the
 * session lookup entirely, for routes that have no use for identity at all and
 * must work where there is no cookie store to read: the health check, and the
 * public registration endpoint in Stage 5.
 */
export type AuthMode = 'required' | 'optional' | 'none'

export interface CreateCtxOptions {
  auth?: AuthMode
  /** Resolves and authorises the organisation. A non-member gets a 404. */
  organizationSlug?: string
  /** Resolves the conference role. Requires an organisation. */
  conferenceId?: string
  request?: Request
}

/**
 * The address the platform observed, not the one the caller claimed.
 *
 * `x-forwarded-for` is caller-settable and therefore useless as a rate-limit or
 * audit key. `x-vercel-forwarded-for` is set by the platform and cannot be
 * forged from outside it.
 */
export function clientAddress(request?: Request): string | undefined {
  if (!request) return undefined
  return (
    request.headers.get('x-vercel-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    undefined
  )
}

export async function createCtx(options: CreateCtxOptions = {}): Promise<Ctx> {
  const { auth = 'required', organizationSlug, conferenceId, request } = options

  const claims = auth === 'none' ? null : await optionalClaims()
  if (!claims && auth === 'required') throw ApiError.unauthorized('Sign in to continue')

  const user = claims ? await getOrCreateUser(claims) : null

  let membership: ResolvedMembership | null = null
  if (organizationSlug) {
    if (!user) throw ApiError.unauthorized('Sign in to continue')
    // Throws 404, not 403. Confirming the organisation exists to someone who is
    // not in it turns the slug field into an enumeration oracle.
    membership = await requireMembership(user.id, organizationSlug)
  }

  let conferenceRole: ConferenceRoleName | undefined
  if (conferenceId) {
    if (!user || !membership) throw ApiError.notFound('Not found')
    const resolved = await resolveConferenceRole(user.id, membership, conferenceId)
    if (!resolved) throw ApiError.notFound('Not found')
    conferenceRole = resolved
  }

  const db = scope({ organizationId: membership?.organizationId, conferenceId })

  const auditContext: AuditContext = {
    organizationId: membership?.organizationId ?? '',
    conferenceId,
    actorUserId: user?.id,
    ip: clientAddress(request),
    userAgent: request?.headers.get('user-agent') ?? undefined,
  }

  return {
    user,
    membership,
    organizationId: membership?.organizationId,
    conferenceId,
    conferenceRole,
    db,
    audit: createAuditRecorder(db, auditContext),
  }
}

/** Narrows `ctx.user` for services that cannot run anonymously. */
export function requireUser(ctx: Ctx): AppUser {
  if (!ctx.user) throw ApiError.unauthorized('Sign in to continue')
  return ctx.user
}

/** Narrows `ctx.membership` for services that need an organisation. */
export function requireOrg(ctx: Ctx): ResolvedMembership {
  if (!ctx.membership) throw ApiError.notFound('Not found')
  return ctx.membership
}

/**
 * Narrows `ctx.conferenceId` for services that operate inside one.
 *
 * 404 rather than 400: reaching here without a conference means the route did
 * not declare `conferenceParam`, and the caller learns nothing useful from
 * being told which of the two it was.
 */
export function requireConference(ctx: Ctx): string {
  if (!ctx.conferenceId) throw ApiError.notFound('Not found')
  return ctx.conferenceId
}
