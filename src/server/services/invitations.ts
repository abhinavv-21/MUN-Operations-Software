import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { recordAudit } from '../audit.ts'
import { scope, scopedCreate } from '../db.ts'
import { findInvitationByTokenHash } from '../scope-resolution.ts'
import { ApiError } from '../errors.ts'
import { requireOrg, requireUser, type Ctx } from '../ctx.ts'
import { requireMemberManager } from '../auth/membership.ts'
import { runSerializable } from '../transaction.ts'

const INVITATION_TTL_DAYS = 14

export const conferenceGrantSchema = z.object({
  conferenceId: z.uuid(),
  role: z.enum(['ADMIN', 'CONTRIBUTOR']),
})

export const createInvitationSchema = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  orgRole: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
  conferenceGrants: z.array(conferenceGrantSchema).max(50).default([]),
})

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>
type ConferenceGrant = z.infer<typeof conferenceGrantSchema>

/**
 * The token is two UUIDs, and only its SHA-256 is stored.
 *
 * Same pattern as the reference product's `Session.tokenHash`, for the same
 * reason: the table cannot be read back into a working credential. Someone with
 * a copy of the database — a backup, a support export, a compromised read
 * replica — holds hashes, not invitations.
 */
function mintToken(): { token: string; tokenHash: string } {
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, '')
  return { token, tokenHash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison, so a near-miss and a wild guess cost the same. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export interface InvitationSummary {
  id: string
  email: string
  orgRole: string
  conferenceGrants: ConferenceGrant[]
  expiresAt: Date
  acceptedAt: Date | null
  createdAt: Date
}

function parseGrants(value: unknown): ConferenceGrant[] {
  const parsed = z.array(conferenceGrantSchema).safeParse(value ?? [])
  return parsed.success ? parsed.data : []
}

/**
 * Validates that every conference named in a grant belongs to this
 * organisation.
 *
 * Not optional. `conferenceGrants` is JSON on a row, so without this check an
 * invitation could name another organisation's conference and acceptance would
 * hand out a role inside a tenant the inviter has no access to.
 */
async function assertGrantsBelongToOrg(
  ctx: Ctx,
  grants: ConferenceGrant[],
): Promise<ConferenceGrant[]> {
  if (grants.length === 0) return []

  const ids = [...new Set(grants.map((grant) => grant.conferenceId))]
  const found = await ctx.db.conference.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  })

  const known = new Set(found.map((conference) => conference.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    throw ApiError.badRequest('That conference is not part of this organisation', {
      conferenceIds: unknown,
    })
  }

  return grants
}

export async function createInvitation(
  ctx: Ctx,
  input: CreateInvitationInput,
): Promise<{ invitation: InvitationSummary; token: string }> {
  const actor = requireUser(ctx)
  const membership = requireOrg(ctx)
  requireMemberManager(membership)

  if (input.orgRole === 'ADMIN' && membership.orgRole === 'MEMBER') {
    throw ApiError.forbidden('You cannot invite someone at a higher level than your own')
  }

  const grants = await assertGrantsBelongToOrg(ctx, input.conferenceGrants)
  const { token, tokenHash } = mintToken()

  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)

  const created = await ctx.db.invitation.create({
    data: scopedCreate<Prisma.InvitationUncheckedCreateInput, 'organizationId'>({
      email: input.email,
      orgRole: input.orgRole,
      conferenceGrants: grants,
      tokenHash,
      expiresAt,
      invitedById: actor.id,
    }),
  })

  await ctx.audit.record({
    action: 'invitation.create',
    entityType: 'Invitation',
    entityId: created.id,
    // The token never reaches the audit trail. `tokenHash` is on the redaction
    // list too: an audit table is read by more people than the table it
    // describes, and a hash is still a lookup key.
    payloadAfter: { email: created.email, orgRole: created.orgRole, grants: grants.length },
  })

  return {
    invitation: {
      id: created.id,
      email: created.email,
      orgRole: created.orgRole,
      conferenceGrants: grants,
      expiresAt: created.expiresAt,
      acceptedAt: created.acceptedAt,
      createdAt: created.createdAt,
    },
    // Returned exactly once, at creation. There is no endpoint that can show it
    // again, because there is nothing stored that could produce it.
    token,
  }
}

export async function listInvitations(ctx: Ctx): Promise<InvitationSummary[]> {
  const membership = requireOrg(ctx)
  requireMemberManager(membership)

  const invitations = await ctx.db.invitation.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    orgRole: invitation.orgRole,
    conferenceGrants: parseGrants(invitation.conferenceGrants),
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
  }))
}

export async function revokeInvitation(ctx: Ctx, invitationId: string): Promise<void> {
  const membership = requireOrg(ctx)
  requireMemberManager(membership)

  const invitation = await ctx.db.invitation.findFirst({
    where: { id: invitationId },
    select: { id: true, email: true, acceptedAt: true },
  })
  if (!invitation) throw ApiError.notFound('Not found')
  if (invitation.acceptedAt) {
    throw ApiError.conflict('That invitation has already been accepted. Remove the member instead.')
  }

  await ctx.db.invitation.delete({ where: { id: invitation.id } })

  await ctx.audit.record({
    action: 'invitation.revoke',
    entityType: 'Invitation',
    entityId: invitation.id,
    payloadBefore: { email: invitation.email },
  })
}

export interface InvitationPreview {
  organizationName: string
  organizationSlug: string
  invitedEmail: string
  orgRole: string
  /** True when the signed-in address differs from the one on the invitation. */
  emailMismatch: boolean
}

/**
 * Looks up an invitation by raw token, for the acceptance screen.
 *
 * The lookup is by hash, so an invalid token finds nothing and there is no
 * comparison to be timed. An expired or already-accepted invitation is reported
 * as simply not found: whether a given token *used to* be valid is not
 * something a stranger holding it should learn.
 */
export async function previewInvitation(
  token: string,
  signedInEmail: string | null,
): Promise<InvitationPreview> {
  const invitation = await findInvitationByTokenHash(hashToken(token))

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw ApiError.notFound('That invitation is no longer valid')
  }

  return {
    organizationName: invitation.organization.name,
    organizationSlug: invitation.organization.slug,
    invitedEmail: invitation.email,
    orgRole: invitation.orgRole,
    emailMismatch: signedInEmail !== null && signedInEmail !== invitation.email,
  }
}

/**
 * Accepts an invitation.
 *
 * The token is authoritative and the email on the invitation is a hint. If the
 * signed-in address differs the acceptance still succeeds, because people
 * forward invitations to the address they actually read — refusing would strand
 * them with no way through. The UI asks "you are signed in as X, accept as X?"
 * before calling this.
 *
 * Ordering is deliberate. Membership and grants are written first and the
 * invitation is marked accepted last, so a failure part-way leaves the
 * invitation usable again rather than spent. Both writes are idempotent under
 * their unique constraints, so retrying is safe.
 */
export async function acceptInvitation(
  ctx: Ctx,
  token: string,
): Promise<{ organizationSlug: string }> {
  const user = requireUser(ctx)

  const invitation = await findInvitationByTokenHash(hashToken(token))

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw ApiError.notFound('That invitation is no longer valid')
  }

  const orgDb = scope({ organizationId: invitation.organizationId })

  const existing = await orgDb.membership.findFirst({
    where: { userId: user.id },
    select: { id: true },
  })

  if (!existing) {
    await orgDb.membership.create({
      data: scopedCreate<Prisma.MembershipUncheckedCreateInput, 'organizationId'>({
        userId: user.id,
        role: invitation.orgRole,
        canManageMembers: false,
      }),
    })
  }

  // One scoped client per grant. A conference-scoped model is not writable with
  // only an organisation in scope, and that restriction is worth keeping for
  // the sake of one loop here.
  for (const grant of parseGrants(invitation.conferenceGrants)) {
    const conference = await orgDb.conference.findFirst({
      where: { id: grant.conferenceId },
      select: { id: true },
    })
    // Silently skipped rather than fatal: a conference deleted between the
    // invitation being sent and accepted should not block someone joining.
    if (!conference) continue

    const conferenceDb = scope({
      organizationId: invitation.organizationId,
      conferenceId: conference.id,
    })

    const held = await conferenceDb.conferenceRole.findFirst({
      where: { userId: user.id },
      select: { id: true },
    })
    if (held) continue

    await conferenceDb.conferenceRole.create({
      data: scopedCreate<Prisma.ConferenceRoleUncheckedCreateInput>({
        userId: user.id,
        role: grant.role,
      }),
    })
  }

  await runSerializable(orgDb, async (tx) => {
    // Re-read inside the transaction so two tabs accepting at once cannot both
    // spend the same invitation.
    const current = await tx.invitation.findFirst({
      where: { id: invitation.id, acceptedAt: null },
      select: { id: true },
    })
    if (!current) return

    await tx.invitation.update({
      where: { id: current.id },
      data: { acceptedAt: new Date(), acceptedByUserId: user.id },
    })

    // Written through the organisation-scoped transaction rather than
    // `ctx.audit`, because this route resolves its organisation from the token
    // and `ctx` therefore has none.
    await recordAudit(tx as unknown as typeof orgDb, {
      actorUserId: user.id,
      action: 'invitation.accept',
      entityType: 'Invitation',
      entityId: invitation.id,
      payloadAfter: { userId: user.id, orgRole: invitation.orgRole },
    })
  })

  ctx.audit.written = true

  return { organizationSlug: invitation.organization.slug }
}
