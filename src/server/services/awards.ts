/**
 * Awards.
 *
 * Admin only, and not for tidiness: the awards list is the one screen whose
 * contents are read aloud at closing ceremony, and a CONTRIBUTOR grant exists
 * so a volunteer can run the door, not decide who wins.
 */

import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { scopedCreate } from '../db.ts'
import { requireConference, requireConferenceAdmin, requireUser, type Ctx } from '../ctx.ts'
import { ApiError } from '../errors.ts'

/**
 * Suggestions for the form, not a constraint on the column.
 *
 * Every circuit names these differently, so the title is free text. Offering
 * the common set stops one committee's list saying "Best Delegate" and the
 * next one's saying "best delegate", which is what makes the export unreadable.
 */
export const SUGGESTED_AWARDS = [
  'Best Delegate',
  'Outstanding Delegate',
  'High Commendation',
  'Special Mention',
  'Verbal Mention',
  'Best Position Paper',
] as const

export const createAwardSchema = z.object({
  committeeId: z.uuid(),
  delegateId: z.uuid(),
  title: z.string().trim().min(2, 'Name the award').max(80),
  rank: z.number().int().min(1).max(99).optional(),
  note: z.string().trim().max(500).optional(),
})

export type CreateAwardInput = z.infer<typeof createAwardSchema>

const AWARD_INCLUDE = {
  committee: { select: { id: true, code: true, name: true } },
  delegate: {
    select: {
      id: true,
      fullName: true,
      email: true,
      schoolName: true,
      assignment: { select: { country: true } },
    },
  },
} as const

/**
 * Reading is open to any conference role.
 *
 * The chairs need the list to read from, and they are CONTRIBUTORs. Only the
 * writes are restricted.
 */
export async function listAwards(ctx: Ctx) {
  requireConference(ctx)

  return ctx.db.award.findMany({
    /*
      Committee code, then rank with nulls last, then title. This is print
      order: an awards list is read committee by committee, best first.

      By `committee.code` and not by `committeeId`. The ids are uuidv7, so
      ordering by one sorts committees by the order somebody happened to create
      them — which is not the order they appear in on any other screen, because
      `listCommittees` and the allocations board both sort by code. Two lists of
      the same committees in two different orders is the kind of thing nobody
      reports and everybody distrusts.
    */
    orderBy: [
      { committee: { code: 'asc' } },
      { rank: { sort: 'asc', nulls: 'last' } },
      { title: 'asc' },
    ],
    include: AWARD_INCLUDE,
  })
}

export async function createAward(ctx: Ctx, input: CreateAwardInput) {
  requireConferenceAdmin(ctx)
  const actor = requireUser(ctx)

  const [committee, delegate] = await Promise.all([
    ctx.db.committee.findFirst({ where: { id: input.committeeId }, select: { id: true, code: true } }),
    ctx.db.delegate.findFirst({
      where: { id: input.delegateId },
      select: { id: true, fullName: true, assignment: { select: { committeeId: true } } },
    }),
  ])

  if (!committee) throw ApiError.notFound('That committee is not in this conference')
  if (!delegate) throw ApiError.notFound('That delegate is not in this conference')

  /*
    The delegate has to actually sit in the committee giving the award.

    Not pedantry. The awards screen is filled in at speed from two dropdowns
    while the ceremony is being lined up, and picking the wrong committee
    produces a certificate with the wrong committee printed on it — discovered
    by the delegate, on stage. A 422 naming both is cheaper than that.
  */
  if (delegate.assignment === null) {
    throw ApiError.unprocessable('Validation failed', [
      { path: 'delegateId', message: `${delegate.fullName} holds no allocation to give an award in` },
    ])
  }
  if (delegate.assignment.committeeId !== committee.id) {
    throw ApiError.unprocessable('Validation failed', [
      { path: 'committeeId', message: `${delegate.fullName} is not in ${committee.code}` },
    ])
  }

  const award = await ctx.db.award.create({
    data: scopedCreate<Prisma.AwardUncheckedCreateInput>({
      committeeId: committee.id,
      delegateId: delegate.id,
      title: input.title,
      rank: input.rank ?? null,
      note: input.note ?? null,
      awardedByUserId: actor.id,
    }),
    include: AWARD_INCLUDE,
  })

  await ctx.audit.record({
    action: 'award.create',
    entityType: 'Award',
    entityId: award.id,
    payloadAfter: {
      committeeId: committee.id,
      delegateId: delegate.id,
      title: award.title,
      rank: award.rank,
    },
  })

  return award
}

export async function deleteAward(ctx: Ctx, awardId: string): Promise<void> {
  requireConferenceAdmin(ctx)

  const existing = await ctx.db.award.findFirst({ where: { id: awardId } })
  if (!existing) throw ApiError.notFound('Not found')

  await ctx.db.award.delete({ where: { id: existing.id } })

  await ctx.audit.record({
    action: 'award.remove',
    entityType: 'Award',
    entityId: existing.id,
    payloadBefore: {
      committeeId: existing.committeeId,
      delegateId: existing.delegateId,
      title: existing.title,
    },
  })
}
