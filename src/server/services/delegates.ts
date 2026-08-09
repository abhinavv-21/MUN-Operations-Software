import { z } from 'zod'
import { requireConference, type Ctx } from '../ctx.ts'

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
