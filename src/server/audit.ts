/**
 * The audit trail.
 *
 * Ported from the reference product's apps/backend/src/lib/audit.ts, including
 * the redaction list and, more importantly, the `client` parameter.
 *
 * That parameter is not decoration. An audit row for a write that later rolled
 * back is worse than no audit row, because it is a record of something that
 * never happened. Passing the transaction client writes both or neither.
 */

import type { Prisma } from '@/generated/prisma/client.ts'
import type { ScopedClient, ScopedCreate } from './db.ts'

/**
 * Replaced with '[redacted]' before anything is stored, at any depth.
 *
 * `tokenHash` is on the list even though it is already a hash: an audit table
 * is read by more people than the table it describes, and a hash is still a
 * lookup key.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'refreshToken',
  'secret',
  'secretHash',
  'accessToken',
  'apiKey',
  'keysAuth',
  'keysP256',
  'appsScript',
])

const REDACTED = '[redacted]'

/**
 * Deep-copies a payload, replacing sensitive values and serialising dates to
 * ISO strings so the stored JSON is stable across drivers.
 */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(redact)

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key) ? REDACTED : redact(inner)
    }
    return out
  }

  return value
}

export interface AuditParams {
  action: string
  entityType: string
  entityId?: string
  payloadBefore?: unknown
  payloadAfter?: unknown
}

export interface AuditContext {
  organizationId: string
  conferenceId?: string
  actorUserId?: string
  ip?: string
  userAgent?: string
}

/**
 * Tracks whether a request wrote an audit row, so `withApi` can complain about
 * a mutation that did not. Cheaper than remembering.
 */
export interface AuditRecorder {
  written: boolean
  record(params: AuditParams, client?: ScopedClient): Promise<void>
}

/**
 * Writes one audit row through an already organisation-scoped client.
 *
 * Exported separately from the recorder because some services build their own
 * scoped client — creating an organisation, or accepting an invitation, both
 * discover their organisation rather than receiving it on `ctx`.
 */
export async function recordAudit(
  db: ScopedClient,
  params: AuditParams & Omit<AuditContext, 'organizationId'>,
): Promise<void> {
  // organizationId is absent because the scoping extension writes it.
  // conferenceId is present because on this model it is a real field.
  const data: ScopedCreate<Prisma.AuditLogUncheckedCreateInput, 'organizationId'> = {
    conferenceId: params.conferenceId ?? null,
    actorUserId: params.actorUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    payloadBefore: redact(params.payloadBefore) as Prisma.InputJsonValue,
    payloadAfter: redact(params.payloadAfter) as Prisma.InputJsonValue,
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
  }

  await db.auditLog.create({ data: data as Prisma.AuditLogUncheckedCreateInput })
}

export function createAuditRecorder(db: ScopedClient, context: AuditContext): AuditRecorder {
  const recorder: AuditRecorder = {
    written: false,
    async record(params, client) {
      await recordAudit(client ?? db, {
        ...params,
        conferenceId: context.conferenceId,
        actorUserId: context.actorUserId,
        ip: context.ip,
        userAgent: context.userAgent,
      })
      recorder.written = true
    },
  }

  return recorder
}
