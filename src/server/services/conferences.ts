import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import type { ConferenceStatus } from '@/generated/prisma/enums.ts'
import { scopedCreate } from '../db.ts'
import { ApiError } from '../errors.ts'
import { requireOrg, requireUser, type Ctx } from '../ctx.ts'
import { isOrgAdmin } from '../auth/membership.ts'
import { assertWithinLimit } from '../limits.ts'
import { themeSchema } from '@/lib/theme/schema.ts'

const conferenceSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')

/**
 * A date arrives from a form as `2026-11-14`, meaning a day rather than an
 * instant. Coerced at the boundary so nothing downstream has to wonder.
 */
const dateOnly = z
  .union([z.iso.date(), z.literal(''), z.null()])
  .transform((value) => (value ? new Date(`${value}T00:00:00.000Z`) : null))
  .nullable()

export const createConferenceSchema = z.object({
  name: z.string().trim().min(2, 'Give the conference a name').max(160),
  slug: conferenceSlug,
  edition: z.string().trim().max(40).nullable().default(null),
})

export const updateConferenceSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  edition: z.string().trim().max(40).nullable().optional(),
  startsOn: dateOnly.optional(),
  endsOn: dateOnly.optional(),
  venue: z.string().trim().max(200).nullable().optional(),
  // Minor units, so 1500.10 never becomes 1500.09 through a float.
  feeMinorUnits: z.number().int().min(0).max(100_000_000).nullable().optional(),
  feeCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code')
    .nullable()
    .optional(),
  registrationDeadline: dateOnly.optional(),
  status: z.enum(['DRAFT', 'OPEN', 'CLOSED', 'ARCHIVED']).optional(),
  theme: themeSchema.nullable().optional(),
  logoUrl: z.url().max(500).nullable().optional(),
})

export type CreateConferenceInput = z.infer<typeof createConferenceSchema>
export type UpdateConferenceInput = z.infer<typeof updateConferenceSchema>

export interface ConferenceSummary {
  id: string
  slug: string
  name: string
  edition: string | null
  status: ConferenceStatus
  startsOn: Date | null
  endsOn: Date | null
  venue: string | null
  committeeCount: number
}

/**
 * Creating and configuring a conference is an organisation-admin power.
 *
 * Deliberately not a conference role: a CONTRIBUTOR on MUN XI has no business
 * creating MUN XII, and the conference-level roles cannot express "may create
 * the next conference" because the next conference does not exist yet.
 */
function requireConferenceAdmin(ctx: Ctx): void {
  const membership = requireOrg(ctx)
  if (!isOrgAdmin(membership.orgRole)) {
    throw ApiError.forbidden('Only an organisation owner or admin can do that')
  }
}

export async function listConferences(ctx: Ctx): Promise<ConferenceSummary[]> {
  requireOrg(ctx)

  const conferences = await ctx.db.conference.findMany({
    orderBy: [{ createdAt: 'desc' }],
    include: { _count: { select: { committees: true } } },
  })

  return conferences.map((conference) => ({
    id: conference.id,
    slug: conference.slug,
    name: conference.name,
    edition: conference.edition,
    status: conference.status,
    startsOn: conference.startsOn,
    endsOn: conference.endsOn,
    venue: conference.venue,
    committeeCount: conference._count.committees,
  }))
}

export async function createConference(
  ctx: Ctx,
  input: CreateConferenceInput,
): Promise<ConferenceSummary> {
  requireUser(ctx)
  requireConferenceAdmin(ctx)
  const membership = requireOrg(ctx)

  // The organisation row is read for its plan, and counted through the scoped
  // client so the count cannot include anyone else's conferences.
  const [organization, current] = await Promise.all([
    ctx.db.organization.findUniqueOrThrow({
      where: { id: membership.organizationId },
      select: { planKey: true, planLimits: true },
    }),
    ctx.db.conference.count(),
  ])

  assertWithinLimit(organization, 'maxConferences', current)

  const created = await ctx.db.conference.create({
    data: scopedCreate<Prisma.ConferenceUncheckedCreateInput, 'organizationId'>({
      slug: input.slug,
      name: input.name,
      edition: input.edition,
    }),
  })

  await ctx.audit.record({
    action: 'conference.create',
    entityType: 'Conference',
    entityId: created.id,
    payloadAfter: { slug: created.slug, name: created.name },
  })

  return {
    id: created.id,
    slug: created.slug,
    name: created.name,
    edition: created.edition,
    status: created.status,
    startsOn: created.startsOn,
    endsOn: created.endsOn,
    venue: created.venue,
    committeeCount: 0,
  }
}

export async function getConference(ctx: Ctx, conferenceId: string) {
  requireOrg(ctx)

  // Scoped by organisation, so a conference id belonging to another
  // organisation simply is not found — a 404, not a 403.
  const conference = await ctx.db.conference.findFirst({ where: { id: conferenceId } })
  if (!conference) throw ApiError.notFound('Not found')

  return conference
}

export async function updateConference(
  ctx: Ctx,
  conferenceId: string,
  input: UpdateConferenceInput,
) {
  requireConferenceAdmin(ctx)

  const before = await getConference(ctx, conferenceId)

  if (
    input.startsOn !== undefined &&
    input.endsOn !== undefined &&
    input.startsOn &&
    input.endsOn &&
    input.endsOn < input.startsOn
  ) {
    throw ApiError.unprocessable('Validation failed', [
      { path: 'endsOn', message: 'The end date cannot be before the start date' },
    ])
  }

  const updated = await ctx.db.conference.update({
    where: { id: before.id },
    data: input as Prisma.ConferenceUncheckedUpdateInput,
  })

  await ctx.audit.record({
    action: 'conference.update',
    entityType: 'Conference',
    entityId: updated.id,
    payloadBefore: before,
    payloadAfter: updated,
  })

  return updated
}
