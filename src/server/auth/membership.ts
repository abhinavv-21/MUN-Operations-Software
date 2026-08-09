/**
 * Effective role resolution.
 *
 * Two levels, coarse over fine:
 *
 *   org OWNER or ADMIN  -> conference ADMIN, on every conference in the org
 *   org MEMBER          -> whatever ConferenceRole says, or nothing at all
 *
 * MEMBER on its own grants nothing. It is a container for conference grants,
 * which is what lets the logistics head for MUN XI have CONTRIBUTOR on XI and
 * no access whatsoever to MUN X now that MUN X is finished.
 *
 * One honest cost: this needs a query per request, because a token cannot carry
 * membership. It is one indexed join, resolved once in `createCtx` and reused
 * for the rest of the request. It is also strictly better than the reference
 * product's fifteen-minute staleness window — removing someone here takes
 * effect on their next request rather than a quarter of an hour later.
 */

import { scope } from '../db.ts'
import { ApiError } from '../errors.ts'
import { findMembershipForUser } from '../scope-resolution.ts'
import type { ConferenceRoleName, OrgRole } from '@/generated/prisma/enums.ts'

export interface ResolvedMembership {
  organizationId: string
  organizationSlug: string
  organizationName: string
  orgRole: OrgRole
  /** Read from the database on every request that needs it, never from a token. */
  canManageMembers: boolean
}

/**
 * Resolves the caller's membership of one organisation, by slug.
 *
 * Returns null for both "no such organisation" and "not a member of it", and
 * the caller turns that into a **404**. Answering 403 to a non-member confirms
 * that an organisation with that slug exists, which turns the sign-up slug
 * field into an enumeration oracle: try `harvard`, try `yale`, learn who is a
 * customer. A 404 says nothing either way.
 */
export async function resolveMembership(
  userId: string,
  organizationSlug: string,
): Promise<ResolvedMembership | null> {
  // Not through ctx.db: this is the query whose answer ctx.db is built from.
  // See src/server/scope-resolution.ts for why that lives in one place.
  const membership = await findMembershipForUser(userId, organizationSlug)

  if (!membership) return null

  return {
    organizationId: membership.organizationId,
    organizationSlug: membership.organization.slug,
    organizationName: membership.organization.name,
    orgRole: membership.role,
    canManageMembers: membership.canManageMembers,
  }
}

export async function requireMembership(
  userId: string,
  organizationSlug: string,
): Promise<ResolvedMembership> {
  const membership = await resolveMembership(userId, organizationSlug)
  if (!membership) throw ApiError.notFound('Not found')
  return membership
}

/** OWNER and ADMIN are the organisation-level administrators. */
export function isOrgAdmin(role: OrgRole): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

export function requireOrgAdmin(membership: ResolvedMembership): void {
  if (!isOrgAdmin(membership.orgRole)) {
    throw ApiError.forbidden('Only an organisation admin can do that')
  }
}

/**
 * Managing accounts is a boolean, not a rung on the role ladder.
 *
 * Carried from the reference product for its original reason: running the
 * conference and deciding who may sign in are different powers, and folding the
 * second into the first means every `role === ADMIN` check silently becomes a
 * check about account management too.
 *
 * OWNER always has it. Being unable to remove the person who broke in is not a
 * state an organisation should be able to reach.
 */
export function requireMemberManager(membership: ResolvedMembership): void {
  if (membership.orgRole === 'OWNER') return
  if (!membership.canManageMembers) {
    throw ApiError.forbidden('You cannot manage members of this organisation')
  }
}

/**
 * The caller's effective role on one conference.
 *
 * Returns null when they have none, which the caller turns into a 404 for the
 * same reason as above.
 */
export async function resolveConferenceRole(
  userId: string,
  membership: ResolvedMembership,
  conferenceId: string,
): Promise<ConferenceRoleName | null> {
  if (isOrgAdmin(membership.orgRole)) return 'ADMIN'

  const db = scope({ organizationId: membership.organizationId })

  // ConferenceRole is conference-scoped but readable across an organisation,
  // which is what makes this one query instead of one per conference.
  const grant = await db.conferenceRole.findFirst({
    where: { userId, conferenceId },
    select: { role: true },
  })

  return grant?.role ?? null
}

export interface ConferenceAccess {
  conferenceId: string
  role: ConferenceRoleName
}

/**
 * Every conference in the organisation the caller can reach, with their role.
 *
 * The conference switcher asks this on every page, which is the reason
 * `ConferenceRole` is readable with only an organisation in scope.
 */
export async function listConferenceAccess(
  userId: string,
  membership: ResolvedMembership,
): Promise<ConferenceAccess[]> {
  const db = scope({ organizationId: membership.organizationId })

  if (isOrgAdmin(membership.orgRole)) {
    const conferences = await db.conference.findMany({ select: { id: true } })
    return conferences.map((conference) => ({ conferenceId: conference.id, role: 'ADMIN' }))
  }

  const grants = await db.conferenceRole.findMany({
    where: { userId },
    select: { conferenceId: true, role: true },
  })

  return grants.map((grant) => ({ conferenceId: grant.conferenceId, role: grant.role }))
}
