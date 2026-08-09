import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { recordAudit } from '../audit.ts'
import { scope, scopedCreate } from '../db.ts'
import { ApiError } from '../errors.ts'
import { uuidv7 } from '../ids.ts'
import { listMembershipsForUser } from '../scope-resolution.ts'
import { requireOrg, requireUser, type Ctx } from '../ctx.ts'
import { isOrgAdmin } from '../auth/membership.ts'
import { assertFeature, computeUsage, type Usage } from '../limits.ts'
import { parseTheme, PRESET_SEEDS, withPreset, type Theme, type ThemeInput } from '@/lib/theme/schema.ts'
import { revalidateOrganizationTheme } from './theme.ts'

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


/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Give the organisation a name').max(120).optional(),
  slug: slugSchema.optional(),
})

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>

/** Settings are an owner-or-admin power, like creating a conference. */
function requireOrganizationAdmin(ctx: Ctx) {
  const membership = requireOrg(ctx)
  if (!isOrgAdmin(membership.orgRole)) {
    throw ApiError.forbidden('Only an organisation owner or admin can do that')
  }
  return membership
}

export interface OrganizationSettings {
  id: string
  slug: string
  name: string
  planKey: string
  theme: Theme
  usage: Usage
}

export async function getOrganizationSettings(ctx: Ctx): Promise<OrganizationSettings> {
  const membership = requireOrganizationAdmin(ctx)

  const organization = await ctx.db.organization.findUniqueOrThrow({
    where: { id: membership.organizationId },
    select: { id: true, slug: true, name: true, planKey: true, planLimits: true, defaultTheme: true },
  })

  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    planKey: organization.planKey,
    theme: parseTheme(organization.defaultTheme),
    usage: await computeUsage(ctx.db, organization),
  }
}

/**
 * Renames an organisation, and optionally moves its address.
 *
 * **Changing the slug moves every public registration URL**, and those are
 * printed on posters and pasted into school newsletters. It is allowed anyway,
 * because the alternative is that a typo made during sign-up is permanent, and
 * an organisation that cannot fix its own address emails you — which is the one
 * thing this stage exists to stop. The form says plainly which links break, and
 * the audit row records both values so the old address can be recovered from the
 * log rather than from memory.
 */
export async function updateOrganization(ctx: Ctx, input: UpdateOrganizationInput) {
  const membership = requireOrganizationAdmin(ctx)

  const before = await ctx.db.organization.findUniqueOrThrow({
    where: { id: membership.organizationId },
    select: { id: true, slug: true, name: true },
  })

  if (input.slug && input.slug !== before.slug) {
    // Checked here for the readable 409; the unique index is what guarantees it.
    const taken = await scope({}).organization.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    })
    assertSlugAvailable(taken !== null)
  }

  const updated = await ctx.db.organization.update({
    where: { id: before.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
    },
    select: { id: true, slug: true, name: true },
  })

  await ctx.audit.record({
    action: 'organization.update',
    entityType: 'Organization',
    entityId: updated.id,
    payloadBefore: { slug: before.slug, name: before.name },
    payloadAfter: { slug: updated.slug, name: updated.name },
  })

  return updated
}

/**
 * Saves the organisation's branding.
 *
 * Only the seeds, the preset, the radius and the font — never CSS. Everything
 * else is derived and contrast-checked by `buildThemeVars`, which is what makes
 * it impossible for an organiser to choose a palette that strands their own
 * text at 1.02:1.
 *
 * Presets are available on every plan; **custom seed colours are the
 * `customBranding` flag**, which had sat in the plan table since Stage 1 with
 * nothing reading it. Choosing a preset and leaving its colours alone is not a
 * custom brand, so the free plan is not blocked from picking navy.
 */
export async function updateOrganizationBranding(ctx: Ctx, input: ThemeInput) {
  const membership = requireOrganizationAdmin(ctx)

  const organization = await ctx.db.organization.findUniqueOrThrow({
    where: { id: membership.organizationId },
    select: { planKey: true, planLimits: true, defaultTheme: true },
  })

  /*
    Only a colour the caller actually sent counts as customising.

    An absent seed means "use the preset", so comparing it against the preset
    would gate `{ "preset": "navy" }` — a plan-included choice — as if it were a
    custom palette.
  */
  const presetSeed = PRESET_SEEDS[input.preset]
  const customised = (Object.keys(presetSeed) as (keyof typeof presetSeed)[]).some(
    (key) => input.seed[key] !== undefined && input.seed[key] !== presetSeed[key],
  )
  if (customised) assertFeature(organization, 'customBranding')

  // Stored resolved, so the row is a complete description of what is rendered
  // and a later change to a preset's colours cannot silently restyle a
  // conference that has already run.
  const theme: Theme = withPreset(input)

  await ctx.db.organization.update({
    where: { id: membership.organizationId },
    data: { defaultTheme: theme as unknown as Prisma.InputJsonValue },
  })

  await ctx.audit.record({
    action: 'organization.branding',
    entityType: 'Organization',
    entityId: membership.organizationId,
    payloadBefore: parseTheme(organization.defaultTheme),
    payloadAfter: theme,
  })

  // Or the palette on screen stays the old one and the save reads as a failure.
  revalidateOrganizationTheme(membership.organizationId)

  return theme
}
