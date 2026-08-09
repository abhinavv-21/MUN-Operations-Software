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

import { createAuditRecorder, type AuditContext, type AuditRecorder } from './audit.ts'
import { scope, type ScopedClient } from './db.ts'

export interface SessionUser {
  id: string
  authUserId: string
  email: string
}

export interface Ctx {
  /** Null until Stage 2 wires Supabase Auth. */
  user: SessionUser | null
  organizationId?: string
  conferenceId?: string
  /** Already scoped. There is no unscoped handle on this object on purpose. */
  db: ScopedClient
  audit: AuditRecorder
}

export interface CreateCtxOptions {
  organizationId?: string
  conferenceId?: string
  user?: SessionUser | null
  request?: Request
}

/**
 * The address the platform observed, not the one the caller claimed.
 *
 * `x-forwarded-for` is caller-settable and therefore useless as a rate-limit
 * or audit key. `x-vercel-forwarded-for` is set by the platform and cannot be
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

export function createCtx(options: CreateCtxOptions = {}): Ctx {
  const { organizationId, conferenceId, user = null, request } = options

  const db = scope({ organizationId, conferenceId })

  const auditContext: AuditContext = {
    organizationId: organizationId ?? '',
    conferenceId,
    actorUserId: user?.id,
    ip: clientAddress(request),
    userAgent: request?.headers.get('user-agent') ?? undefined,
  }

  return {
    user,
    organizationId,
    conferenceId,
    db,
    audit: createAuditRecorder(db, auditContext),
  }
}
