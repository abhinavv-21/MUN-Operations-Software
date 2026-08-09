/**
 * Reading the audit trail.
 *
 * The write path is `src/server/audit.ts`; this is the only read path, and it
 * is deliberately the only one. An append-only log is worth nothing if the
 * answer to "who deleted that committee" is a database console.
 *
 * Conference-scoped and admin-only. `AuditLog` carries both ids, so this reads
 * the organisation-scoped rows filtered to one conference — organisation-level
 * actions (inviting a member, transferring ownership) have a null
 * `conferenceId` and are not in this view. They belong to the organisation
 * settings screen in Stage 8, which is where the people who can act on them
 * are.
 */

import { z } from 'zod'
import { requireConference, requireConferenceAdmin, type Ctx } from '../ctx.ts'

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

  const where = {
    conferenceId,
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

  const [actions, entityTypes, actorIds] = await Promise.all([
    ctx.db.auditLog.groupBy({ by: ['action'], where: { conferenceId }, orderBy: { action: 'asc' } }),
    ctx.db.auditLog.groupBy({
      by: ['entityType'],
      where: { conferenceId },
      orderBy: { entityType: 'asc' },
    }),
    ctx.db.auditLog.groupBy({ by: ['actorUserId'], where: { conferenceId } }),
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
