/**
 * The conference dashboard.
 *
 * Every number here answers a question someone asks out loud during the day.
 * Nothing is here because it was easy to count: a dashboard of vanity totals is
 * a screen people stop opening by mid-morning, and then they stop opening it on
 * the day it would have told them something.
 */

import { requireConference, type Ctx } from '../ctx.ts'
import { attendanceSummary, formatDay, type AttendanceSummary } from './attendance.ts'
import { logisticsSummary } from './logistics.ts'

export interface ConferenceDashboard {
  day: string
  delegates: number
  committees: number
  allocated: number
  unallocated: number
  pendingRegistrations: number
  awards: number
  attendance: AttendanceSummary
  logistics: Awaited<ReturnType<typeof logisticsSummary>>
  /** Committees whose matrix is full, so the board reads at a glance. */
  committeeLoad: {
    id: string
    code: string
    name: string
    seats: number | null
    filled: number
  }[]
  urgent: {
    id: string
    title: string
    committee: string | null
    createdAt: string
  }[]
}

/**
 * `today` is passed in rather than read from the clock.
 *
 * The server runs in UTC and the conference runs in a venue. A dashboard that
 * decides which day it is from the server's clock shows an empty register for
 * five and a half hours every morning in India, which is exactly the window
 * when the register is the only thing anyone is looking at.
 */
export async function conferenceDashboard(
  ctx: Ctx,
  today: string = formatDay(new Date()),
): Promise<ConferenceDashboard> {
  requireConference(ctx)

  const [
    delegates,
    committees,
    allocated,
    pendingRegistrations,
    awards,
    attendance,
    logistics,
    committeeRows,
    filledPerCommittee,
    urgent,
  ] = await Promise.all([
    ctx.db.delegate.count(),
    ctx.db.committee.count(),
    ctx.db.assignment.count(),
    ctx.db.registration.count({ where: { status: 'PENDING' } }),
    ctx.db.award.count(),
    attendanceSummary(ctx, today),
    logisticsSummary(ctx),
    ctx.db.committee.findMany({
      select: { id: true, code: true, name: true, seats: true },
      orderBy: { code: 'asc' },
    }),
    ctx.db.assignment.groupBy({ by: ['committeeId'], _count: { _all: true } }),
    ctx.db.logisticsRequest.findMany({
      where: { priority: 'URGENT', status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: {
        id: true,
        title: true,
        createdAt: true,
        committee: { select: { code: true } },
      },
    }),
  ])

  const filledBy = new Map(filledPerCommittee.map((row) => [row.committeeId, row._count._all]))

  return {
    day: today,
    delegates,
    committees,
    allocated,
    unallocated: Math.max(0, delegates - allocated),
    pendingRegistrations,
    awards,
    attendance,
    logistics,
    committeeLoad: committeeRows.map((committee) => ({
      ...committee,
      filled: filledBy.get(committee.id) ?? 0,
    })),
    urgent: urgent.map((request) => ({
      id: request.id,
      title: request.title,
      committee: request.committee?.code ?? null,
      createdAt: request.createdAt.toISOString(),
    })),
  }
}
