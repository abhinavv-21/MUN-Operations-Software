/**
 * Reading the audit trail.
 *
 * The write path is `src/server/audit.ts`; this is the only read path, and it
 * is deliberately the only one. An append-only log is worth nothing if the
 * answer to "who deleted that committee" is a database console.
 *
 * Two views, and the split is about who can act on what.
 *
 * The **conference** view is scoped to one conference and open to its admins:
 * everything done to that conference, which is what somebody asks about on the
 * day.
 *
 * The **organisation** view is owner-and-admin only and shows everything,
 * including rows with a null `conferenceId` — inviting a member, transferring
 * ownership, renaming the organisation — and, since Stage 8, the rows left
 * behind by a deleted conference. That last one is why this view had to exist:
 * `AuditLog.conferenceId` is `SetNull`, so deleting a conference detaches its
 * history rather than destroying it, and detached history with nowhere to read
 * it is the same as no history.
 */

import { z } from 'zod'
import { requireConference, requireConferenceAdmin, requireOrg, type Ctx } from '../ctx.ts'
import { isOrgAdmin } from '../auth/membership.ts'
import { ApiError } from '../errors.ts'

/** A page big enough to scan, small enough that the query stays indexed. */
const PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export const auditFiltersSchema = z.object({
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(80).optional(),
  actorUserId: z.uuid().optional(),
  /** Inclusive, as `YYYY-MM-DD` in the reader's own reading of the calendar. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** The id of the last row on the previous page. */
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
  /** Organisation view only. `organization` hides everything filed under a conference. */
  scope: z.enum(['all', 'organization']).default('all'),
})

export type AuditFilters = z.infer<typeof auditFiltersSchema>

export interface AuditPage {
  entries: {
    id: string
    action: string
    entityType: string
    entityId: string | null
    createdAt: string
    actor: { id: string; fullName: string | null; email: string } | null
    payloadBefore: unknown
    payloadAfter: unknown
    ip: string | null
  }[]
  nextCursor: string | null
}

export async function listAuditLog(ctx: Ctx, filters: AuditFilters): Promise<AuditPage> {
  const conferenceId = requireConferenceAdmin(ctx)
  return readAuditLog(ctx, filters, { conferenceId })
}

/**
 * The organisation-wide view. Owner and admin only.
 *
 * `scope` decides what the reader is looking at: `'all'` is everything in the
 * organisation, `'organization'` is only the rows with no conference — which is
 * the filter that answers "what happened outside a conference", and the one
 * that surfaces a deleted conference's trail.
 */
export async function listOrganizationAuditLog(
  ctx: Ctx,
  filters: AuditFilters,
): Promise<AuditPage> {
  const membership = requireOrg(ctx)
  if (!isOrgAdmin(membership.orgRole)) {
    throw ApiError.forbidden('Only an organisation owner or admin can read the audit log')
  }

  return readAuditLog(
    ctx,
    filters,
    filters.scope === 'organization' ? { conferenceId: null } : {},
  )
}

async function readAuditLog(
  ctx: Ctx,
  filters: AuditFilters,
  conferenceFilter: { conferenceId?: string | null },
): Promise<AuditPage> {
  const where = {
    ...conferenceFilter,
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
            // `to` is inclusive of the whole day, because a reader who types
            // the fourteenth means the fourteenth and not midnight starting it.
            ...(filters.to ? { lt: new Date(`${filters.to}T00:00:00.000Z`) } : {}),
          },
        }
      : {}),
  }

  /*
    Ordered and paged by `id`, not by `createdAt`.

    Ids are uuidv7, so they already sort by creation time — and unlike a
    timestamp they are unique, so a page boundary cannot land in the middle of
    two rows written in the same millisecond and either repeat one or skip one.
    An audit log that occasionally omits a row while you page through it is
    worse than no audit log, because you would never know.
  */
  const rows = await ctx.db.auditLog.findMany({
    where,
    orderBy: { id: 'desc' },
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      createdAt: true,
      payloadBefore: true,
      payloadAfter: true,
      ip: true,
      actor: { select: { id: true, fullName: true, email: true } },
    },
  })

  const page = rows.slice(0, filters.limit)

  return {
    entries: page.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > filters.limit ? (page.at(-1)?.id ?? null) : null,
  }
}

/**
 * The distinct actions and actors present, for the filter controls.
 *
 * Built from the data rather than from a hardcoded list of action strings: a
 * list in code goes stale the first time someone adds a service and does not
 * update it, and a filter offering an action that never happens is a filter
 * that returns nothing and looks broken.
 */
export async function auditFacets(ctx: Ctx) {
  const conferenceId = requireConference(ctx)
  requireConferenceAdmin(ctx)
  return readFacets(ctx, { conferenceId })
}

export async function organizationAuditFacets(ctx: Ctx) {
  const membership = requireOrg(ctx)
  if (!isOrgAdmin(membership.orgRole)) {
    throw ApiError.forbidden('Only an organisation owner or admin can read the audit log')
  }
  return readFacets(ctx, {})
}

async function readFacets(ctx: Ctx, where: { conferenceId?: string | null }) {
  const [actions, entityTypes, actorIds] = await Promise.all([
    ctx.db.auditLog.groupBy({ by: ['action'], where, orderBy: { action: 'asc' } }),
    ctx.db.auditLog.groupBy({
      by: ['entityType'],
      where,
      orderBy: { entityType: 'asc' },
    }),
    ctx.db.auditLog.groupBy({ by: ['actorUserId'], where }),
  ])

  const ids = actorIds
    .map((row) => row.actorUserId)
    .filter((id): id is string => id !== null)

  const actors =
    ids.length > 0
      ? await ctx.db.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true, email: true },
          orderBy: { email: 'asc' },
        })
      : []

  return {
    actions: actions.map((row) => row.action),
    entityTypes: entityTypes.map((row) => row.entityType),
    actors,
  }
}
