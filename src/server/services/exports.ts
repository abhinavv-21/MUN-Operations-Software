/**
 * The datasets an organiser can export, and who may.
 *
 * Assembled here rather than in the route handler, so the authorization runs
 * for a Server Component too — invariant 3. Every dataset is one query through
 * `ctx.db`, so a conference id from another organisation produces an empty
 * table rather than someone else's delegates, and the route never gets that far
 * anyway because `createCtx` resolved the conference first.
 */

import { z } from 'zod'
import { requireConference, requireConferenceAdmin, type Ctx } from '../ctx.ts'
import type { Table } from '../exporters/index.ts'
import { formatDay, parseDay } from './attendance.ts'

export const EXPORT_DATASETS = [
  'delegates',
  'allocations',
  'attendance',
  'logistics',
  'awards',
  'registrations',
] as const

export type ExportDataset = (typeof EXPORT_DATASETS)[number]

export const exportQuerySchema = z.object({
  /** Attendance only. Absent means every day on record. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export interface DatasetDescriptor {
  key: ExportDataset
  label: string
  description: string
  /** Attendance takes an optional day; nothing else takes a parameter. */
  takesDay?: boolean
}

export const DATASETS: DatasetDescriptor[] = [
  {
    key: 'delegates',
    label: 'Delegates',
    description: 'Every delegate with their school, contact details and allocation.',
  },
  {
    key: 'allocations',
    label: 'Allocations',
    description: 'Committee by committee, who holds which country.',
  },
  {
    key: 'attendance',
    label: 'Attendance',
    description: 'The register, for one day or for every day on record.',
    takesDay: true,
  },
  {
    key: 'logistics',
    label: 'Logistics requests',
    description: 'What was asked for, who resolved it and how.',
  },
  { key: 'awards', label: 'Awards', description: 'The list read at closing ceremony.' },
  {
    key: 'registrations',
    label: 'Registrations',
    description: 'Every application received, including the ones turned down.',
  },
]

/**
 * Exports are conference ADMIN only, every dataset.
 *
 * A CONTRIBUTOR can see a delegate on the check-in screen — they have to, to
 * do the job — but a file is different from a screen. Three hundred names,
 * emails and phone numbers of school students, downloaded onto a volunteer's
 * laptop and living there after the conference, is not the same exposure as
 * looking one up at the door.
 */
export async function buildExport(
  ctx: Ctx,
  dataset: ExportDataset,
  options: { day?: string } = {},
): Promise<Table> {
  requireConference(ctx)
  requireConferenceAdmin(ctx)

  const conference = await ctx.db.conference.findFirstOrThrow({
    where: { id: ctx.conferenceId },
    select: { name: true },
  })

  const table = await buildTable(ctx, dataset, options)

  await ctx.audit.record({
    action: 'export.download',
    entityType: 'Conference',
    entityId: ctx.conferenceId,
    payloadAfter: { dataset, day: options.day ?? null, rows: table.rows.length },
  })

  return { ...table, title: `${conference.name} — ${table.title}` }
}

async function buildTable(
  ctx: Ctx,
  dataset: ExportDataset,
  options: { day?: string },
): Promise<Table> {
  switch (dataset) {
    case 'delegates':
      return delegatesTable(ctx)
    case 'allocations':
      return allocationsTable(ctx)
    case 'attendance':
      return attendanceTable(ctx, options.day)
    case 'logistics':
      return logisticsTable(ctx)
    case 'awards':
      return awardsTable(ctx)
    case 'registrations':
      return registrationsTable(ctx)
  }
}

async function delegatesTable(ctx: Ctx): Promise<Table> {
  const delegates = await ctx.db.delegate.findMany({
    orderBy: [{ fullName: 'asc' }],
    include: {
      assignment: { select: { country: true, committee: { select: { code: true } } } },
    },
  })

  return {
    title: 'Delegates',
    subtitle: `${delegates.length} delegates`,
    columns: [
      { header: 'Name' },
      { header: 'Email' },
      { header: 'Phone' },
      { header: 'School' },
      { header: 'Grade' },
      { header: 'Committee' },
      { header: 'Country' },
    ],
    rows: delegates.map((delegate) => [
      delegate.fullName,
      delegate.email,
      delegate.phone,
      delegate.schoolName,
      delegate.grade,
      delegate.assignment?.committee.code ?? null,
      delegate.assignment?.country ?? null,
    ]),
  }
}

async function allocationsTable(ctx: Ctx): Promise<Table> {
  const assignments = await ctx.db.assignment.findMany({
    orderBy: [{ committee: { code: 'asc' } }, { country: 'asc' }],
    include: {
      committee: { select: { code: true, name: true } },
      delegate: { select: { fullName: true, email: true, schoolName: true } },
    },
  })

  return {
    title: 'Allocations',
    subtitle: `${assignments.length} seats filled`,
    columns: [
      { header: 'Committee' },
      { header: 'Country' },
      { header: 'Delegate' },
      { header: 'School' },
      { header: 'Email' },
    ],
    rows: assignments.map((assignment) => [
      assignment.committee.code,
      assignment.country,
      assignment.delegate.fullName,
      assignment.delegate.schoolName,
      assignment.delegate.email,
    ]),
  }
}

/**
 * The register.
 *
 * With no day, this is every mark on record. With a day, it is that day —
 * **including the delegates who were never marked**, because a register that
 * lists only the people who turned up cannot be used to work out who did not,
 * which is the only reason anyone prints one.
 */
async function attendanceTable(ctx: Ctx, dayValue?: string): Promise<Table> {
  if (!dayValue) {
    const records = await ctx.db.attendanceRecord.findMany({
      orderBy: [{ day: 'asc' }],
      include: {
        delegate: {
          select: {
            fullName: true,
            schoolName: true,
            assignment: { select: { country: true, committee: { select: { code: true } } } },
          },
        },
      },
    })

    return {
      title: 'Attendance',
      subtitle: `${records.length} marks across every day on record`,
      columns: [
        { header: 'Day' },
        { header: 'Delegate' },
        { header: 'Committee' },
        { header: 'Country' },
        { header: 'School' },
        { header: 'Status' },
        { header: 'Marked at' },
      ],
      rows: records.map((record) => [
        formatDay(record.day),
        record.delegate.fullName,
        record.delegate.assignment?.committee.code ?? null,
        record.delegate.assignment?.country ?? null,
        record.delegate.schoolName,
        record.status,
        record.markedAt,
      ]),
    }
  }

  const day = parseDay(dayValue)
  const delegates = await ctx.db.delegate.findMany({
    orderBy: [{ fullName: 'asc' }],
    select: {
      fullName: true,
      schoolName: true,
      assignment: { select: { country: true, committee: { select: { code: true } } } },
      attendance: { where: { day }, select: { status: true, markedAt: true, note: true } },
    },
  })

  return {
    title: `Attendance ${dayValue}`,
    subtitle: `${delegates.length} delegates`,
    columns: [
      { header: 'Delegate' },
      { header: 'Committee' },
      { header: 'Country' },
      { header: 'School' },
      { header: 'Status' },
      { header: 'Marked at' },
      { header: 'Note' },
    ],
    rows: delegates.map((delegate) => {
      const record = delegate.attendance[0]
      return [
        delegate.fullName,
        delegate.assignment?.committee.code ?? null,
        delegate.assignment?.country ?? null,
        delegate.schoolName,
        record?.status ?? 'NOT MARKED',
        record?.markedAt ?? null,
        record?.note ?? null,
      ]
    }),
  }
}

async function logisticsTable(ctx: Ctx): Promise<Table> {
  const requests = await ctx.db.logisticsRequest.findMany({
    orderBy: [{ createdAt: 'asc' }],
    include: {
      committee: { select: { code: true } },
      requestedBy: { select: { fullName: true, email: true } },
      resolvedBy: { select: { fullName: true, email: true } },
    },
  })

  return {
    title: 'Logistics requests',
    subtitle: `${requests.length} requests`,
    columns: [
      { header: 'Raised' },
      { header: 'Committee' },
      { header: 'Category' },
      { header: 'Priority' },
      { header: 'Status' },
      { header: 'Request' },
      { header: 'Detail' },
      { header: 'Raised by' },
      { header: 'Resolved by' },
      { header: 'Resolution' },
    ],
    rows: requests.map((request) => [
      request.createdAt,
      request.committee?.code ?? null,
      request.category,
      request.priority,
      request.status,
      request.title,
      request.detail,
      request.requestedBy?.fullName ?? request.requestedBy?.email ?? null,
      request.resolvedBy?.fullName ?? request.resolvedBy?.email ?? null,
      request.resolution,
    ]),
  }
}

async function awardsTable(ctx: Ctx): Promise<Table> {
  const awards = await ctx.db.award.findMany({
    // Committee code, matching the awards screen and every other committee
    // list. See listAwards for why not committeeId.
    orderBy: [
      { committee: { code: 'asc' } },
      { rank: { sort: 'asc', nulls: 'last' } },
      { title: 'asc' },
    ],
    include: {
      committee: { select: { code: true, name: true } },
      delegate: {
        select: { fullName: true, schoolName: true, assignment: { select: { country: true } } },
      },
    },
  })

  return {
    title: 'Awards',
    subtitle: `${awards.length} awards`,
    columns: [
      { header: 'Committee' },
      { header: 'Award' },
      { header: 'Delegate' },
      { header: 'Country' },
      { header: 'School' },
      { header: 'Note' },
    ],
    rows: awards.map((award) => [
      award.committee.code,
      award.title,
      award.delegate.fullName,
      award.delegate.assignment?.country ?? null,
      award.delegate.schoolName,
      award.note,
    ]),
  }
}

async function registrationsTable(ctx: Ctx): Promise<Table> {
  const registrations = await ctx.db.registration.findMany({
    orderBy: [{ createdAt: 'asc' }],
  })

  return {
    title: 'Registrations',
    subtitle: `${registrations.length} applications`,
    columns: [
      { header: 'Reference' },
      { header: 'Received' },
      { header: 'Status' },
      { header: 'Name' },
      { header: 'Email' },
      { header: 'Phone' },
      { header: 'School' },
      { header: 'Grade' },
      { header: 'First preference' },
      { header: 'Second preference' },
      { header: 'MUNs attended', numeric: true },
      { header: 'Awards won', numeric: true },
      { header: 'Rejection reason' },
    ],
    rows: registrations.map((registration) => [
      registration.reference,
      registration.createdAt,
      registration.status,
      registration.fullName,
      registration.email,
      registration.phone,
      registration.schoolName,
      registration.grade,
      registration.committeePreference,
      registration.committeePreference2,
      registration.munsAttended,
      registration.awardsWon,
      registration.rejectionReason,
    ]),
  }
}
