import { z } from 'zod'
import type { OrgRole } from '@/generated/prisma/enums.ts'
import { ApiError } from '../errors.ts'
import { requireOrg, requireUser, type Ctx } from '../ctx.ts'
import { requireMemberManager } from '../auth/membership.ts'
import { runSerializable } from '../transaction.ts'

export const updateMemberSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(),
  canManageMembers: z.boolean().optional(),
})

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>

export interface MemberSummary {
  userId: string
  email: string
  fullName: string | null
  avatarUrl: string | null
  role: OrgRole
  canManageMembers: boolean
  joinedAt: Date
}

export async function listMembers(ctx: Ctx): Promise<MemberSummary[]> {
  requireOrg(ctx)

  // Scoped by organisation through ctx.db, so there is no `where` to forget.
  const memberships = await ctx.db.membership.findMany({
    select: {
      userId: true,
      role: true,
      canManageMembers: true,
      createdAt: true,
      user: { select: { email: true, fullName: true, avatarUrl: true } },
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  })

  return memberships.map((membership) => ({
    userId: membership.userId,
    email: membership.user.email,
    fullName: membership.user.fullName,
    avatarUrl: membership.user.avatarUrl,
    role: membership.role,
    canManageMembers: membership.canManageMembers,
    joinedAt: membership.createdAt,
  }))
}

/**
 * The organisation must always have at least one OWNER.
 *
 * An organisation with none is not merely awkward — nobody can promote anyone,
 * nobody can transfer ownership, and no screen in the product can repair it.
 * Counted inside the same serializable transaction as the write, because two
 * owners demoting each other simultaneously both read "2 owners" otherwise.
 */
async function assertNotLastOwner(
  tx: Ctx['db'],
  userId: string,
  action: 'demote' | 'remove',
): Promise<void> {
  const owners = await tx.membership.findMany({
    where: { role: 'OWNER' },
    select: { userId: true },
  })

  const isOwner = owners.some((owner) => owner.userId === userId)
  if (!isOwner) return

  if (owners.length <= 1) {
    throw ApiError.forbidden(
      action === 'demote'
        ? 'This is the only owner. Make someone else an owner first.'
        : 'This is the only owner. Transfer ownership before removing them.',
      { reason: 'last_owner' },
    )
  }
}

export async function updateMember(
  ctx: Ctx,
  targetUserId: string,
  input: UpdateMemberInput,
): Promise<MemberSummary> {
  const actor = requireUser(ctx)
  const membership = requireOrg(ctx)
  requireMemberManager(membership)

  if (input.role !== undefined && !['OWNER', 'ADMIN'].includes(membership.orgRole)) {
    throw ApiError.forbidden('Only an owner or admin can change roles')
  }

  // Only an owner may mint another owner. An admin promoting themselves to
  // owner is a privilege escalation with extra steps.
  if (input.role === 'OWNER' && membership.orgRole !== 'OWNER') {
    throw ApiError.forbidden('Only an owner can make someone else an owner')
  }

  return runSerializable(ctx.db, async (tx) => {
    const before = await tx.membership.findFirst({
      where: { userId: targetUserId },
      select: { id: true, role: true, canManageMembers: true },
    })
    if (!before) throw ApiError.notFound('That person is not a member of this organisation')

    if (input.role && input.role !== 'OWNER' && before.role === 'OWNER') {
      await assertNotLastOwner(tx, targetUserId, 'demote')
    }

    const updated = await tx.membership.update({
      where: { id: before.id },
      data: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.canManageMembers !== undefined
          ? { canManageMembers: input.canManageMembers }
          : {}),
      },
      select: {
        userId: true,
        role: true,
        canManageMembers: true,
        createdAt: true,
        user: { select: { email: true, fullName: true, avatarUrl: true } },
      },
    })

    await ctx.audit.record(
      {
        action: 'membership.update',
        entityType: 'Membership',
        entityId: before.id,
        payloadBefore: { role: before.role, canManageMembers: before.canManageMembers },
        payloadAfter: { role: updated.role, canManageMembers: updated.canManageMembers },
      },
      tx,
    )

    void actor

    return {
      userId: updated.userId,
      email: updated.user.email,
      fullName: updated.user.fullName,
      avatarUrl: updated.user.avatarUrl,
      role: updated.role,
      canManageMembers: updated.canManageMembers,
      joinedAt: updated.createdAt,
    }
  })
}

export async function removeMember(ctx: Ctx, targetUserId: string): Promise<void> {
  const membership = requireOrg(ctx)
  requireMemberManager(membership)

  await runSerializable(ctx.db, async (tx) => {
    const target = await tx.membership.findFirst({
      where: { userId: targetUserId },
      select: { id: true, role: true, canManageMembers: true },
    })
    if (!target) throw ApiError.notFound('That person is not a member of this organisation')

    await assertNotLastOwner(tx, targetUserId, 'remove')

    await tx.membership.delete({ where: { id: target.id } })

    // Their conference grants go with them. Leaving orphaned grants means
    // re-inviting someone silently restores access they used to have.
    await tx.conferenceRole.deleteMany({ where: { userId: targetUserId } })

    await ctx.audit.record(
      {
        action: 'membership.remove',
        entityType: 'Membership',
        entityId: target.id,
        payloadBefore: { userId: targetUserId, role: target.role },
      },
      tx,
    )
  })
}

/**
 * Ownership transfer, as one explicit action rather than two role changes.
 *
 * Doing it as "promote them, demote me" leaves a window with two owners and,
 * worse, a window with none if the second step fails.
 */
export async function transferOwnership(ctx: Ctx, targetUserId: string): Promise<void> {
  const actor = requireUser(ctx)
  const membership = requireOrg(ctx)

  if (membership.orgRole !== 'OWNER') {
    throw ApiError.forbidden('Only an owner can transfer ownership')
  }
  if (targetUserId === actor.id) {
    throw ApiError.badRequest('You already own this organisation')
  }

  await runSerializable(ctx.db, async (tx) => {
    const target = await tx.membership.findFirst({
      where: { userId: targetUserId },
      select: { id: true, role: true },
    })
    if (!target) throw ApiError.notFound('That person is not a member of this organisation')

    const mine = await tx.membership.findFirst({
      where: { userId: actor.id },
      select: { id: true },
    })
    if (!mine) throw ApiError.notFound('Not found')

    await tx.membership.update({
      where: { id: target.id },
      data: { role: 'OWNER', canManageMembers: true },
    })
    await tx.membership.update({ where: { id: mine.id }, data: { role: 'ADMIN' } })

    await ctx.audit.record(
      {
        action: 'organization.transfer_ownership',
        entityType: 'Organization',
        entityId: membership.organizationId,
        payloadBefore: { ownerUserId: actor.id },
        payloadAfter: { ownerUserId: targetUserId },
      },
      tx,
    )
  })
}
