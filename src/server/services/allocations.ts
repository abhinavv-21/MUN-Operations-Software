import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { scopedCreate } from '../db.ts'
import { ApiError } from '../errors.ts'
import { requireConference, type Ctx } from '../ctx.ts'
import { runSerializable } from '../transaction.ts'
import { describeMatrix, parseMatrix } from '../matrix.ts'

export const allocateSchema = z.object({
  delegateId: z.uuid(),
  committeeId: z.uuid(),
  country: z.string().trim().min(1, 'Name a country').max(80),
})

export const importMatrixSchema = z.object({
  csv: z.string().min(1, 'Paste a matrix').max(2_000_000),
  /** Replace wipes each named committee's matrix first. Merge adds to it. */
  mode: z.enum(['replace', 'merge']).default('replace'),
})

export type AllocateInput = z.infer<typeof allocateSchema>

/**
 * Allocates a country to a delegate.
 *
 * Serializable, because seat capacity is a read-then-write: two organisers
 * allocating the last seat in UNSC at the same moment both read "14 of 15
 * filled" and both write.
 *
 * The database-level `@@unique([conferenceId, committeeId, country])` catches
 * the country collision; this transaction catches the capacity one. **You need
 * both** — the constraint is the guarantee, and the transaction is what turns
 * a race into a clean 409 instead of a crash.
 */
export async function allocate(ctx: Ctx, input: AllocateInput) {
  requireConference(ctx)

  return runSerializable(ctx.db, async (tx) => {
    const [delegate, committee] = await Promise.all([
      tx.delegate.findFirst({ where: { id: input.delegateId }, select: { id: true } }),
      tx.committee.findFirst({
        where: { id: input.committeeId },
        select: { id: true, code: true, seats: true },
      }),
    ])

    if (!delegate) throw ApiError.notFound('That delegate is not in this conference')
    if (!committee) throw ApiError.notFound('That committee is not in this conference')

    /*
      The country matrix, enforced here rather than in the UI.

      Zero rows for a committee means it is **unconstrained** and accepts
      free-text countries. That is a supported state, not a missing one: it is
      what lets one committee's matrix be imported without freezing the other
      five.

      The reference product checks this in exactly one of its three allocation
      paths, which its own notes list as a known gap. There is one path here.
    */
    const matrixSize = await tx.committeeCountry.count({ where: { committeeId: committee.id } })
    if (matrixSize > 0) {
      const permitted = await tx.committeeCountry.findFirst({
        where: { committeeId: committee.id, country: { equals: input.country, mode: 'insensitive' } },
        select: { country: true },
      })
      if (!permitted) {
        throw ApiError.unprocessable('Validation failed', [
          {
            path: 'country',
            message: `${committee.code} has a country matrix and "${input.country}" is not in it.`,
          },
        ])
      }
    }

    // The read half of the read-then-write the transaction exists to protect.
    if (committee.seats !== null) {
      const filled = await tx.assignment.count({ where: { committeeId: committee.id } })
      if (filled >= committee.seats) {
        throw ApiError.conflict(`${committee.code} is full — ${filled} of ${committee.seats} seats.`)
      }
    }

    const existing = await tx.assignment.findFirst({
      where: { delegateId: delegate.id },
      select: { id: true },
    })

    // One seat per delegate. Moving is an update, not a second row.
    const assignment = existing
      ? await tx.assignment.update({
          where: { id: existing.id },
          data: { committeeId: committee.id, country: input.country },
        })
      : await tx.assignment.create({
          data: scopedCreate<Prisma.AssignmentUncheckedCreateInput>({
            delegateId: delegate.id,
            committeeId: committee.id,
            country: input.country,
          }),
        })

    await ctx.audit.record(
      {
        action: existing ? 'assignment.move' : 'assignment.create',
        entityType: 'Assignment',
        entityId: assignment.id,
        payloadAfter: {
          delegateId: delegate.id,
          committeeId: committee.id,
          country: input.country,
        },
      },
      tx,
    )

    return assignment
  })
}

export async function unallocate(ctx: Ctx, delegateId: string): Promise<void> {
  requireConference(ctx)

  const existing = await ctx.db.assignment.findFirst({ where: { delegateId } })
  if (!existing) throw ApiError.notFound('That delegate holds no allocation')

  await ctx.db.assignment.delete({ where: { id: existing.id } })

  await ctx.audit.record({
    action: 'assignment.remove',
    entityType: 'Assignment',
    entityId: existing.id,
    payloadBefore: { delegateId, committeeId: existing.committeeId, country: existing.country },
  })
}

export async function listAllocations(ctx: Ctx) {
  requireConference(ctx)

  return ctx.db.assignment.findMany({
    orderBy: [{ committeeId: 'asc' }, { country: 'asc' }],
    include: {
      committee: { select: { code: true, name: true } },
      delegate: { select: { fullName: true, email: true, schoolName: true } },
    },
  })
}

export interface MatrixImportSummary {
  created: number
  removed: number
  unknownCommittees: string[]
  knownCommittees: string[]
  skipped: { row: number; reason: string }[]
  shape: 'wide' | 'long' | 'unknown'
  message: string
}

/**
 * Imports a country matrix.
 *
 * Refuses to invent a committee. A column naming something that does not exist
 * is reported and skipped, never created — a typo in a header would otherwise
 * produce a committee nobody meant to run, and the first anyone would know of
 * it is a delegate allocated into it.
 */
export async function importMatrix(
  ctx: Ctx,
  csv: string,
  mode: 'replace' | 'merge',
): Promise<MatrixImportSummary> {
  requireConference(ctx)

  const committees = await ctx.db.committee.findMany({ select: { id: true, code: true } })
  const byCode = new Map(committees.map((committee) => [committee.code, committee.id]))

  const parsed = parseMatrix(
    csv,
    committees.map((committee) => committee.code),
  )

  let removed = 0
  if (mode === 'replace' && parsed.knownCommittees.length > 0) {
    const ids = parsed.knownCommittees.map((code) => byCode.get(code)!).filter(Boolean)
    // Only the committees this file names. A matrix covering two committees
    // must not wipe the other four.
    const result = await ctx.db.committeeCountry.deleteMany({ where: { committeeId: { in: ids } } })
    removed = result.count
  }

  // De-duplicated per committee, case-insensitively, so "france" and "France"
  // are one seat rather than a unique-constraint failure mid-import.
  const seen = new Set<string>()
  const rows = parsed.entries.filter((entry) => {
    const key = `${entry.committeeCode}::${entry.country.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  let created = 0
  if (rows.length > 0) {
    const result = await ctx.db.committeeCountry.createMany({
      data: rows.map((entry) =>
        scopedCreate<Prisma.CommitteeCountryUncheckedCreateInput>({
          committeeId: byCode.get(entry.committeeCode)!,
          country: entry.country,
          seats: entry.seats,
        }),
      ),
      skipDuplicates: true,
    })
    created = result.count
  }

  await ctx.audit.record({
    action: 'matrix.import',
    entityType: 'Conference',
    entityId: ctx.conferenceId,
    payloadAfter: {
      shape: parsed.shape,
      created,
      removed,
      unknownCommittees: parsed.unknownCommittees,
    },
  })

  return {
    created,
    removed,
    unknownCommittees: parsed.unknownCommittees,
    knownCommittees: parsed.knownCommittees,
    skipped: parsed.skipped,
    shape: parsed.shape,
    message: describeMatrix(parsed),
  }
}
