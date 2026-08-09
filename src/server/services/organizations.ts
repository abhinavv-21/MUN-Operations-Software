import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { recordAudit } from '../audit.ts'
import { scope, scopedCreate } from '../db.ts'
import { ApiError } from '../errors.ts'
import { uuidv7 } from '../ids.ts'
import { listMembershipsForUser } from '../scope-resolution.ts'
import { requireUser, type Ctx } from '../ctx.ts'

/**
 * Slugs are the organisation's public address, in `/app/<slug>` and
 * `/r/<slug>/<conference>`. Reserved words are refused up front rather than
 * discovered later as a routing collision.
 */
const RESERVED_SLUGS = new Set([
  'api',
  'app',
  'r',
  'auth',
  'admin',
  'dev',
  'new',
  'sign-in',
  'sign-up',
  'invite',
  'invitations',
  'settings',
  'account',
  'billing',
  'support',
  'docs',
  'status',
  'www',
  'static',
  '_next',
])

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters')
  .max(48, 'Use at most 48 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')
  .refine((value) => !RESERVED_SLUGS.has(value), 'That address is reserved')

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Give the organisation a name').max(120),
  slug: slugSchema,
})

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>

export interface OrganizationSummary {
  id: string
  slug: string
  name: string
  role: string
}

/**
 * Creates an organisation and makes the caller its OWNER.
 *
 * Both rows are written in one transaction. An organisation with no members is
 * unreachable by anyone, including the person who just created it, and there is
 * no screen anywhere that could repair it.
 */
export async function createOrganization(
  ctx: Ctx,
  input: CreateOrganizationInput,
): Promise<OrganizationSummary> {
  const user = requireUser(ctx)

  // The id is generated here rather than by Postgres so that the scope exists
  // before the first write. `Membership` and `AuditLog` are organisation-scoped
  // and cannot be written without one; creating the organisation first and then
  // switching clients would put the membership in a second transaction, and a
  // failure there leaves an organisation nobody can reach — including the
  // person who just made it, with no screen in the product able to repair it.
  //
  // `Organization` itself is a global model, so it passes straight through this
  // client untouched.
  const organizationId = uuidv7()
  const db = scope({ organizationId })

  const created = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { id: organizationId, slug: input.slug, name: input.name },
    })

    await tx.membership.create({
      data: scopedCreate<Prisma.MembershipUncheckedCreateInput, 'organizationId'>({
        userId: user.id,
        role: 'OWNER',
        // The first owner can manage members by definition. Otherwise the
        // person who created the organisation cannot invite anyone into it.
        canManageMembers: true,
      }),
    })

    await recordAudit(tx as unknown as typeof db, {
      actorUserId: user.id,
      action: 'organization.create',
      entityType: 'Organization',
      entityId: organization.id,
      payloadAfter: { slug: organization.slug, name: organization.name },
    })

    return organization
  })

  ctx.audit.written = true

  return { id: created.id, slug: created.slug, name: created.name, role: 'OWNER' }
}

/** Every organisation the caller belongs to, for the switcher and the home screen. */
export async function listMyOrganizations(ctx: Ctx): Promise<OrganizationSummary[]> {
  const user = requireUser(ctx)
  const memberships = await listMembershipsForUser(user.id)

  return memberships.map((membership) => ({
    id: membership.organization.id,
    slug: membership.organization.slug,
    name: membership.organization.name,
    role: membership.role,
  }))
}

/** Whether a slug is free, for the inline check on the create-organisation form. */
export async function isSlugAvailable(slug: string): Promise<boolean> {
  const parsed = slugSchema.safeParse(slug)
  if (!parsed.success) return false

  const db = scope({})
  const taken = await db.organization.findUnique({
    where: { slug: parsed.data },
    select: { id: true },
  })

  return taken === null
}

/**
 * Turns a name into a candidate slug. A suggestion only — the unique index is
 * what actually reserves it, and a collision is a 409 the form recovers from.
 */
export function suggestSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')

  if (base.length < 3 || RESERVED_SLUGS.has(base)) return ''
  return base
}

export function assertSlugAvailable(taken: boolean): void {
  if (taken) throw ApiError.conflict('That address is already taken')
}
