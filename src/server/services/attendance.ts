/**
 * Attendance.
 *
 * One of the two writes the offline queue is allowed to hold, and the reason
 * the check-in path is written the way it is: everything here has to be safe to
 * replay, because a check-in made at the registration desk on venue wifi may
 * arrive minutes later, twice, from two devices.
 */

import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { scopedCreate } from '../db.ts'
import { requireConference, requireUser, type Ctx } from '../ctx.ts'
import { ApiError } from '../errors.ts'
import { runSerializable } from '../transaction.ts'

/**
 * A calendar date, as the venue's calendar has it.
 *
 * Parsed from `YYYY-MM-DD` into UTC midnight and stored in a `DATE` column, so
 * the value never passes through a timezone that could move it a day. A
 * `z.coerce.date()` here would accept an ISO instant and quietly shift the
 * whole register by one day for anyone east of Greenwich.
 */
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form 2026-03-14')

export function parseDay(value: string): Date {
  const day = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(day.getTime())) {
    throw ApiError.unprocessable('Validation failed', [
      { path: 'day', message: 'That is not a real date' },
    ])
  }
  return day
}

/** `Date` back to the `YYYY-MM-DD` the client sent. */
export function formatDay(day: Date): string {
  return day.toISOString().slice(0, 10)
}

export const attendanceFiltersSchema = z.object({
  day: daySchema,
  committeeId: z.uuid().optional(),
  search: z.string().trim().max(120).optional(),
})

export const checkInSchema = z.object({
  delegateId: z.uuid(),
  day: daySchema,
  status: z.enum(['PRESENT', 'LATE', 'ABSENT']).default('PRESENT'),
  note: z.string().trim().max(240).optional(),
})

export type AttendanceFilters = z.infer<typeof attendanceFiltersSchema>
export type CheckInInput = z.infer<typeof checkInSchema>

/**
 * The register for one day: every delegate, with their mark if they have one.
 *
 * Delegate-led rather than record-led on purpose. A list of attendance rows
 * answers "who came"; the desk needs "who has not", which is the complement and
 * is invisible in a table of records.
 */
export async function listAttendance(ctx: Ctx, filters: AttendanceFilters) {
  requireConference(ctx)

  const day = parseDay(filters.day)
  const search = filters.search

  const delegates = await ctx.db.delegate.findMany({
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
      ...(filters.committeeId ? { assignment: { committeeId: filters.committeeId } } : {}),
    },
    orderBy: [{ fullName: 'asc' }],
    select: {
      id: true,
      fullName: true,
      email: true,
      schoolName: true,
      assignment: {
        select: { country: true, committee: { select: { id: true, code: true } } },
      },
      attendance: {
        where: { day },
        select: { id: true, status: true, markedAt: true, note: true },
      },
    },
  })

  return delegates.map((delegate) => {
    const { attendance, ...rest } = delegate
    const record = attendance[0] ?? null
    return {
      ...rest,
      attendance: record
        ? { ...record, markedAt: record.markedAt.toISOString() }
        : null,
    }
  })
}

export interface AttendanceSummary {
  day: string
  total: number
  present: number
  late: number
  absent: number
  unmarked: number
}

export async function attendanceSummary(ctx: Ctx, dayValue: string): Promise<AttendanceSummary> {
  requireConference(ctx)

  const day = parseDay(dayValue)

  const [total, grouped] = await Promise.all([
    ctx.db.delegate.count(),
    ctx.db.attendanceRecord.groupBy({
      by: ['status'],
      where: { day },
      _count: { _all: true },
    }),
  ])

  const counts = { PRESENT: 0, LATE: 0, ABSENT: 0 }
  for (const row of grouped) counts[row.status] = row._count._all

  return {
    day: dayValue,
    total,
    present: counts.PRESENT,
    late: counts.LATE,
    absent: counts.ABSENT,
    // The number the desk actually watches. Nobody asks how many are present;
    // they ask how many are still missing.
    unmarked: Math.max(0, total - counts.PRESENT - counts.LATE - counts.ABSENT),
  }
}

/**
 * Marks one delegate for one day.
 *
 * **Idempotent by construction**, which is what makes it safe to queue. The
 * unique key is `(conference, delegate, day)`, so a replay finds the existing
 * row rather than writing a second one. Re-sending the identical mark changes
 * nothing and reports `changed: false`; sending a different status is an
 * amendment and updates it.
 *
 * Serializable, because two devices marking the same delegate in the same
 * second would otherwise both see no row and both insert, and one of them would
 * arrive at the unique index as a 500. `runSerializable` turns that into a
 * retry that finds the row the other one wrote.
 *
 * CONTRIBUTOR is enough. Manning the desk is the whole reason the role exists.
 */
export async function checkIn(ctx: Ctx, input: CheckInInput) {
  requireConference(ctx)
  const actor = requireUser(ctx)

  const day = parseDay(input.day)

  return runSerializable(ctx.db, async (tx) => {
    const delegate = await tx.delegate.findFirst({
      where: { id: input.delegateId },
      select: { id: true, fullName: true },
    })
    if (!delegate) throw ApiError.notFound('That delegate is not in this conference')

    const existing = await tx.attendanceRecord.findFirst({
      where: { delegateId: delegate.id, day },
    })

    const unchanged =
      existing !== null &&
      existing.status === input.status &&
      (existing.note ?? null) === (input.note ?? null)

    const record = existing
      ? unchanged
        ? existing
        : await tx.attendanceRecord.update({
            where: { id: existing.id },
            data: {
              status: input.status,
              note: input.note ?? null,
              markedAt: new Date(),
              markedByUserId: actor.id,
            },
          })
      : await tx.attendanceRecord.create({
          data: scopedCreate<Prisma.AttendanceRecordUncheckedCreateInput>({
            delegateId: delegate.id,
            day,
            status: input.status,
            note: input.note ?? null,
            markedByUserId: actor.id,
          }),
        })

    /*
      An audit row goes in even when nothing changed.

      The record is the state; the log is the history, and "this delegate was
      scanned three times at the door" is a question the log is the only place
      to answer. `unchanged` distinguishes a replay from an amendment so reading
      the log later does not suggest the mark was edited when it was not.
    */
    await ctx.audit.record(
      {
        action: 'attendance.checkin',
        entityType: 'AttendanceRecord',
        entityId: record.id,
        payloadBefore: existing ? { status: existing.status, note: existing.note } : undefined,
        payloadAfter: {
          delegateId: delegate.id,
          day: input.day,
          status: input.status,
          unchanged,
        },
      },
      tx,
    )

    return {
      record: { ...record, day: formatDay(record.day), markedAt: record.markedAt.toISOString() },
      changed: !unchanged,
      created: existing === null,
    }
  })
}
