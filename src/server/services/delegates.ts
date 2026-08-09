import { z } from 'zod'
import { ApiError } from '../errors.ts'
import { requireConference, requireConferenceAdmin, type Ctx } from '../ctx.ts'

export const delegateFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  committeeId: z.uuid().optional(),
  /** 'unallocated' is the filter an organiser actually lives in. */
  allocation: z.enum(['any', 'allocated', 'unallocated']).default('any'),
})

export type DelegateFilters = z.infer<typeof delegateFiltersSchema>

export async function listDelegates(ctx: Ctx, filters: DelegateFilters) {
  requireConference(ctx)

  const search = filters.search

  return ctx.db.delegate.findMany({
    where: {
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { schoolName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(filters.allocation === 'allocated' ? { assignment: { isNot: null } } : {}),
      ...(filters.allocation === 'unallocated' ? { assignment: { is: null } } : {}),
      ...(filters.committeeId ? { assignment: { committeeId: filters.committeeId } } : {}),
    },
    orderBy: [{ fullName: 'asc' }],
    include: {
      assignment: {
        select: { id: true, country: true, committee: { select: { id: true, code: true } } },
      },
    },
  })
}

export const updateDelegateSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter their name').max(120).optional(),
    email: z.email('Enter a valid email address').optional(),
    phone: z.string().trim().max(40).nullish(),
    schoolName: z.string().trim().max(160).nullish(),
    grade: z.string().trim().max(40).nullish(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Change something',
  })

export type UpdateDelegateInput = z.infer<typeof updateDelegateSchema>

/**
 * Corrects a delegate's details.
 *
 * This is the write the offline queue must **not** hold, and it is worth being
 * explicit about why, because it looks no more dangerous than a check-in.
 *
 * A check-in is append-only from the operator's side: two people marking the
 * same delegate present agree. An edit overwrites. Queue one and you have
 * queued a conflict — the registration desk fixes a spelling at 09:10 with no
 * signal, the secretariat fixes the same field differently at 09:40 with
 * signal, and at 09:50 the queue flushes and silently reinstates the older
 * value over the newer one. Nobody sees it happen and the log shows both writes
 * succeeding.
 *
 * So this fails immediately when there is no connection, with a message saying
 * so. The person retypes it in thirty seconds; nobody loses an hour to a
 * mystery.
 */
export async function updateDelegate(ctx: Ctx, delegateId: string, input: UpdateDelegateInput) {
  requireConferenceAdmin(ctx)

  const existing = await ctx.db.delegate.findFirst({ where: { id: delegateId } })
  if (!existing) throw ApiError.notFound('Not found')

  const updated = await ctx.db.delegate.update({
    where: { id: existing.id },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.schoolName !== undefined ? { schoolName: input.schoolName } : {}),
      ...(input.grade !== undefined ? { grade: input.grade } : {}),
    },
  })

  await ctx.audit.record({
    action: 'delegate.update',
    entityType: 'Delegate',
    entityId: updated.id,
    payloadBefore: {
      fullName: existing.fullName,
      email: existing.email,
      phone: existing.phone,
      schoolName: existing.schoolName,
      grade: existing.grade,
    },
    payloadAfter: {
      fullName: updated.fullName,
      email: updated.email,
      phone: updated.phone,
      schoolName: updated.schoolName,
      grade: updated.grade,
    },
  })

  return updated
}

/**
 * Seat counts per committee, for the allocations board.
 *
 * One query rather than one per committee: this renders on every allocation,
 * and N+1 here is N+1 during the hour when the secretariat is allocating
 * fastest.
 */
export async function committeeCapacity(ctx: Ctx) {
  requireConference(ctx)

  const [committees, filled, matrixSizes] = await Promise.all([
    ctx.db.committee.findMany({
      select: { id: true, code: true, name: true, seats: true },
      orderBy: { code: 'asc' },
    }),
    ctx.db.assignment.groupBy({ by: ['committeeId'], _count: { _all: true } }),
    ctx.db.committeeCountry.groupBy({ by: ['committeeId'], _count: { _all: true } }),
  ])

  const filledBy = new Map(filled.map((row) => [row.committeeId, row._count._all]))
  const matrixBy = new Map(matrixSizes.map((row) => [row.committeeId, row._count._all]))

  return committees.map((committee) => ({
    ...committee,
    filled: filledBy.get(committee.id) ?? 0,
    // Zero means unconstrained, which the board says in words rather than
    // showing an empty list that reads as "nothing configured yet".
    matrixSize: matrixBy.get(committee.id) ?? 0,
  }))
}

/** The countries still free in one committee. */
export async function availableCountries(ctx: Ctx, committeeId: string) {
  requireConference(ctx)

  const [matrix, taken] = await Promise.all([
    ctx.db.committeeCountry.findMany({
      where: { committeeId },
      select: { country: true, seats: true },
      orderBy: { country: 'asc' },
    }),
    ctx.db.assignment.findMany({ where: { committeeId }, select: { country: true } }),
  ])

  const held = new Set(taken.map((row) => row.country.toLowerCase()))

  return matrix
    .filter((row) => !held.has(row.country.toLowerCase()))
    .map((row) => ({ country: row.country, seats: row.seats }))
}
