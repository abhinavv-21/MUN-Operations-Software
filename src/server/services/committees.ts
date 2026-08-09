import { z } from 'zod'
import type { Prisma } from '@/generated/prisma/client.ts'
import { scopedCreate } from '../db.ts'
import { ApiError } from '../errors.ts'
import { requireConference, type Ctx } from '../ctx.ts'
import { assertWithinLimit } from '../limits.ts'

export const createCommitteeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Give the committee a short code')
    .max(16)
    .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens'),
  name: z.string().trim().min(2, 'Give the committee a full name').max(120),
  seats: z.number().int().min(1).max(1000).nullable().default(null),
})

export const updateCommitteeSchema = createCommitteeSchema.partial()

export const setCountriesSchema = z.object({
  countries: z
    .array(
      z.object({
        country: z.string().trim().min(1).max(80),
        seats: z.number().int().min(1).max(10).default(1),
      }),
    )
    .max(400),
})

export type CreateCommitteeInput = z.infer<typeof createCommitteeSchema>
export type UpdateCommitteeInput = z.infer<typeof updateCommitteeSchema>

export interface CommitteeSummary {
  id: string
  code: string
  name: string
  seats: number | null
  countryCount: number
}

export async function listCommittees(ctx: Ctx): Promise<CommitteeSummary[]> {
  requireConference(ctx)

  const committees = await ctx.db.committee.findMany({
    orderBy: [{ code: 'asc' }],
    include: { _count: { select: { countries: true } } },
  })

  return committees.map((committee) => ({
    id: committee.id,
    code: committee.code,
    name: committee.name,
    seats: committee.seats,
    countryCount: committee._count.countries,
  }))
}

export async function createCommittee(
  ctx: Ctx,
  input: CreateCommitteeInput,
): Promise<CommitteeSummary> {
  requireConference(ctx)

  const organizationId = ctx.organizationId
  if (!organizationId) throw ApiError.notFound('Not found')

  const [organization, current] = await Promise.all([
    ctx.db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { planKey: true, planLimits: true },
    }),
    ctx.db.committee.count(),
  ])

  assertWithinLimit(organization, 'maxCommitteesPerConference', current)

  // conferenceId is injected by the scoping extension. A P2002 here is the
  // per-conference uniqueness doing its job and becomes a 409 through the
  // error ladder, with a message that names the collision.
  const created = await ctx.db.committee.create({
    data: scopedCreate<Prisma.CommitteeUncheckedCreateInput>({
      code: input.code,
      name: input.name,
      seats: input.seats,
    }),
  })

  await ctx.audit.record({
    action: 'committee.create',
    entityType: 'Committee',
    entityId: created.id,
    payloadAfter: { code: created.code, name: created.name, seats: created.seats },
  })

  return { id: created.id, code: created.code, name: created.name, seats: created.seats, countryCount: 0 }
}

export async function updateCommittee(
  ctx: Ctx,
  committeeId: string,
  input: UpdateCommitteeInput,
): Promise<CommitteeSummary> {
  requireConference(ctx)

  const before = await ctx.db.committee.findFirst({ where: { id: committeeId } })
  if (!before) throw ApiError.notFound('Not found')

  const updated = await ctx.db.committee.update({
    where: { id: before.id },
    data: input,
    include: { _count: { select: { countries: true } } },
  })

  await ctx.audit.record({
    action: 'committee.update',
    entityType: 'Committee',
    entityId: updated.id,
    payloadBefore: { code: before.code, name: before.name, seats: before.seats },
    payloadAfter: { code: updated.code, name: updated.name, seats: updated.seats },
  })

  return {
    id: updated.id,
    code: updated.code,
    name: updated.name,
    seats: updated.seats,
    countryCount: updated._count.countries,
  }
}

export async function deleteCommittee(ctx: Ctx, committeeId: string): Promise<void> {
  requireConference(ctx)

  const before = await ctx.db.committee.findFirst({ where: { id: committeeId } })
  if (!before) throw ApiError.notFound('Not found')

  await ctx.db.committee.delete({ where: { id: before.id } })

  await ctx.audit.record({
    action: 'committee.delete',
    entityType: 'Committee',
    entityId: before.id,
    payloadBefore: { code: before.code, name: before.name },
  })
}

export async function listCountries(ctx: Ctx, committeeId: string) {
  requireConference(ctx)

  const committee = await ctx.db.committee.findFirst({ where: { id: committeeId } })
  if (!committee) throw ApiError.notFound('Not found')

  return ctx.db.committeeCountry.findMany({
    where: { committeeId: committee.id },
    orderBy: { country: 'asc' },
    select: { id: true, country: true, seats: true },
  })
}

/**
 * Replaces a committee's country matrix.
 *
 * Replace rather than merge, because the matrix is a document an organiser
 * edits as a whole — a partial update leaves rows nobody remembers adding.
 *
 * Zero countries is a supported state and means the committee is
 * unconstrained: free-text countries are accepted for it. That is what lets one
 * committee's matrix be imported without freezing the other five.
 */
export async function setCountries(
  ctx: Ctx,
  committeeId: string,
  countries: { country: string; seats: number }[],
): Promise<{ count: number }> {
  requireConference(ctx)

  const committee = await ctx.db.committee.findFirst({ where: { id: committeeId } })
  if (!committee) throw ApiError.notFound('Not found')

  // Case-insensitive de-duplication. "france" and "France" are one seat, and
  // letting both in produces a matrix where the same country is available twice.
  const seen = new Map<string, { country: string; seats: number }>()
  for (const entry of countries) {
    const key = entry.country.trim().toLowerCase()
    if (key && !seen.has(key)) seen.set(key, { country: entry.country.trim(), seats: entry.seats })
  }
  const unique = [...seen.values()]

  const before = await ctx.db.committeeCountry.count({ where: { committeeId: committee.id } })

  await ctx.db.committeeCountry.deleteMany({ where: { committeeId: committee.id } })

  if (unique.length > 0) {
    await ctx.db.committeeCountry.createMany({
      data: unique.map((entry) =>
        scopedCreate<Prisma.CommitteeCountryUncheckedCreateInput>({
          committeeId: committee.id,
          country: entry.country,
          seats: entry.seats,
        }),
      ),
    })
  }

  await ctx.audit.record({
    action: 'committee.set_countries',
    entityType: 'Committee',
    entityId: committee.id,
    payloadBefore: { countryCount: before },
    payloadAfter: { countryCount: unique.length },
  })

  return { count: unique.length }
}
