import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import type { RegistrationStatus } from '@/generated/prisma/enums.ts'
import { scopedCreate } from '../db.ts'
import { ApiError } from '../errors.ts'
import { requireConference, requireUser, type Ctx } from '../ctx.ts'
import { runSerializable } from '../transaction.ts'
import { checkReviewTransition } from '../registrations.ts'
import { assertWithinLimit } from '../limits.ts'

export const reviewFiltersSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().trim().max(120).optional(),
})

export const rejectSchema = z.object({
  reason: z.string().trim().min(3, 'Say why, so the decision can be explained later').max(500),
})

export type ReviewFilters = z.infer<typeof reviewFiltersSchema>

export async function listRegistrations(ctx: Ctx, filters: ReviewFilters = {}) {
  requireConference(ctx)

  const search = filters.search
  return ctx.db.registration.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { reference: { contains: search.toUpperCase() } },
              { schoolName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
  })
}

export async function registrationStats(ctx: Ctx) {
  requireConference(ctx)

  const grouped = await ctx.db.registration.groupBy({
    by: ['status'],
    _count: { _all: true },
  })

  const counts: Record<RegistrationStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 }
  for (const row of grouped) counts[row.status] = row._count._all
  return counts
}

/**
 * Approves an application and creates the delegate it describes.
 *
 * **It never allocates.** The committee preference on the registration is
 * copied nowhere. A form answer is a wish; an allocation is a decision the
 * secretariat makes with the whole matrix in front of them, and silently
 * honouring a stated preference is the worst kind of helpful.
 *
 * Serializable, because approving twice concurrently would otherwise mint two
 * delegates for one application.
 */
export async function approveRegistration(ctx: Ctx, registrationId: string) {
  const actor = requireUser(ctx)
  requireConference(ctx)

  const organizationId = ctx.organizationId
  if (!organizationId) throw ApiError.notFound('Not found')

  const organization = await ctx.db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { planKey: true, planLimits: true },
  })

  return runSerializable(ctx.db, async (tx) => {
    const registration = await tx.registration.findFirst({ where: { id: registrationId } })
    if (!registration) throw ApiError.notFound('Not found')

    const transition = checkReviewTransition(registration.status, 'approve')
    if (!transition.allowed) throw ApiError.conflict(transition.reason ?? 'Cannot approve this')

    const current = await tx.delegate.count()
    assertWithinLimit(organization, 'maxDelegatesPerConference', current)

    // Per-conference unique email. The same student registering for MUN X and
    // MUN XI is the case this product exists to serve, so the collision here is
    // only ever within one conference.
    const clash = await tx.delegate.findFirst({
      where: { email: registration.email },
      select: { id: true },
    })
    if (clash) {
      throw ApiError.conflict(
        'A delegate with that email already exists in this conference. Link or remove them first.',
      )
    }

    const delegate = await tx.delegate.create({
      data: scopedCreate<Prisma.DelegateUncheckedCreateInput>({
        fullName: registration.fullName,
        email: registration.email,
        phone: registration.phone,
        schoolName: registration.schoolName,
        grade: registration.grade,
        registrationId: registration.id,
      }),
    })

    await tx.registration.update({
      where: { id: registration.id },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedByUserId: actor.id,
        rejectionReason: null,
      },
    })

    await ctx.audit.record(
      {
        action: 'registration.approve',
        entityType: 'Registration',
        entityId: registration.id,
        payloadBefore: { status: registration.status },
        payloadAfter: { status: 'APPROVED', delegateId: delegate.id },
      },
      tx,
    )

    return delegate
  })
}

/** Rejection takes a reason, because "why was I turned down" is asked later. */
export async function rejectRegistration(ctx: Ctx, registrationId: string, reason: string) {
  const actor = requireUser(ctx)
  requireConference(ctx)

  return runSerializable(ctx.db, async (tx) => {
    const registration = await tx.registration.findFirst({ where: { id: registrationId } })
    if (!registration) throw ApiError.notFound('Not found')

    const transition = checkReviewTransition(registration.status, 'reject')
    if (!transition.allowed) throw ApiError.conflict(transition.reason ?? 'Cannot reject this')

    const updated = await tx.registration.update({
      where: { id: registration.id },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedByUserId: actor.id,
        rejectionReason: reason,
      },
    })

    await ctx.audit.record(
      {
        action: 'registration.reject',
        entityType: 'Registration',
        entityId: registration.id,
        payloadBefore: { status: registration.status },
        payloadAfter: { status: 'REJECTED', reason },
      },
      tx,
    )

    return updated
  })
}
