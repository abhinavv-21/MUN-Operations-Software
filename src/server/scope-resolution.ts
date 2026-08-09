/**
 * The reads that discover a scope, rather than operating inside one.
 *
 * There are exactly three, and they exist here rather than in a service because
 * each has the same chicken-and-egg shape: you cannot scope a query by the
 * organisation when the point of the query is to work out which organisation
 * you are in. `resolveMembership` cannot use `ctx.db`, because `ctx.db` is
 * built from its answer.
 *
 * Keeping them in one small module — rather than relaxing the scoping extension
 * so services can do it themselves — means the complete list of unscoped reads
 * in the product is this file, and it is short enough to read in full during a
 * review. Each one is filtered by a key the caller supplies: a user id, or the
 * hash of a secret. None of them can return "everything".
 *
 * This module is on the `unsafeDb` allowlist in eslint.config.mjs for that
 * reason. Adding a fourth function here should feel like a decision.
 */

import { unsafeDb } from './db.ts'
import type { OrgRole } from '@/generated/prisma/enums.ts'

export interface MembershipRow {
  organizationId: string
  role: OrgRole
  canManageMembers: boolean
  organization: { slug: string; name: string }
}

/**
 * One user's membership of one organisation, by slug.
 *
 * Filtered by `userId`, so the worst it can return is a row about the caller.
 * Returns null for both "no such organisation" and "not a member", which is
 * what lets the caller answer 404 to both without knowing which it was.
 */
export function findMembershipForUser(
  userId: string,
  organizationSlug: string,
): Promise<MembershipRow | null> {
  return unsafeDb.membership.findFirst({
    where: { userId, organization: { slug: organizationSlug } },
    select: {
      organizationId: true,
      role: true,
      canManageMembers: true,
      organization: { select: { slug: true, name: true } },
    },
  })
}

/** Every organisation one user belongs to, for the switcher and the home screen. */
export function listMembershipsForUser(userId: string) {
  return unsafeDb.membership.findMany({
    where: { userId },
    select: {
      role: true,
      organization: { select: { id: true, slug: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * An invitation, by the hash of its token.
 *
 * The token is the scope: holding it is what identifies the organisation. The
 * lookup is by hash rather than by comparison, so an invalid token simply finds
 * nothing and there is no string comparison to time.
 */
export function findInvitationByTokenHash(tokenHash: string) {
  return unsafeDb.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      email: true,
      orgRole: true,
      conferenceGrants: true,
      expiresAt: true,
      acceptedAt: true,
      organization: { select: { slug: true, name: true } },
    },
  })
}
