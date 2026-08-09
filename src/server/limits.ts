import { ApiError } from './errors.ts'
import type { ScopedClient } from './db.ts'

/**
 * Plans are code, not a table.
 *
 * A plans table means a migration and a seed to change a number, plus a second
 * source of truth that can disagree with what the pricing page says. This file
 * is the pricing page's source of truth as well.
 *
 * There is no Stripe in v1 and no upgrade flow. `Organization.planLimits` is
 * the upgrade flow: a customer emails saying they have 400 delegates and their
 * ceiling is raised with one row update instead of a deploy.
 */
export const PLANS = {
  free: {
    label: 'Free',
    maxConferences: 2,
    maxDelegatesPerConference: 150,
    maxCommitteesPerConference: 12,
    maxMembers: 5,
    maxStorageMb: 500,
    customBranding: false,
  },
  pro: {
    label: 'Pro',
    maxConferences: 12,
    maxDelegatesPerConference: 1200,
    maxCommitteesPerConference: 40,
    maxMembers: 40,
    maxStorageMb: 20_000,
    customBranding: true,
  },
} as const

export type PlanKey = keyof typeof PLANS
export type Plan = (typeof PLANS)[PlanKey]
export type NumericLimit = {
  [K in keyof Plan]: Plan[K] extends number ? K : never
}[keyof Plan]

const DEFAULT_PLAN: PlanKey = 'free'

function planFor(planKey: string): Plan {
  return PLANS[planKey as PlanKey] ?? PLANS[DEFAULT_PLAN]
}

/**
 * The plan, with any per-organisation overrides merged over it.
 *
 * Overrides are a JSON column rather than a column per limit, because the set
 * of limits changes and a schema migration per pricing experiment is not a
 * trade worth making. Unknown keys are ignored, so an override written for a
 * limit that no longer exists is inert rather than fatal.
 */
export function effectiveLimits(organization: {
  planKey: string
  planLimits?: unknown
}): Plan & Record<string, unknown> {
  const base = planFor(organization.planKey)
  const overrides = organization.planLimits

  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    return { ...base }
  }

  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    if (key in base) merged[key] = value
  }

  return merged as Plan & Record<string, unknown>
}

export interface LimitDetails {
  limit: string
  current: number
  max: number
  planKey: string
}

/**
 * The single funnel every create path goes through.
 *
 * **403, not 402.** A 402 with no payment mechanism behind it is a lie — there
 * is nothing the caller can pay. The UI keys on `details.limit` to decide which
 * upgrade prompt to render, not on the status code, so the code only has to be
 * honest rather than clever.
 */
export function assertWithinLimit(
  organization: { planKey: string; planLimits?: unknown },
  limit: NumericLimit,
  current: number,
  adding = 1,
): void {
  const limits = effectiveLimits(organization)
  const max = limits[limit]

  if (typeof max !== 'number') return
  if (current + adding <= max) return

  const details: LimitDetails = {
    limit,
    current,
    max,
    planKey: organization.planKey,
  }

  throw ApiError.forbidden(LIMIT_MESSAGES[limit](max), details)
}

const LIMIT_MESSAGES: Record<NumericLimit, (max: number) => string> = {
  maxConferences: (max) =>
    `Your plan includes ${max} conferences. Archive one, or ask us to raise the limit.`,
  maxDelegatesPerConference: (max) =>
    `Your plan includes ${max} delegates per conference. Ask us to raise the limit.`,
  maxCommitteesPerConference: (max) =>
    `Your plan includes ${max} committees per conference. Ask us to raise the limit.`,
  maxMembers: (max) =>
    `Your plan includes ${max} people. Remove someone, or ask us to raise the limit.`,
  maxStorageMb: (max) => `Your plan includes ${max} MB of uploads. Ask us to raise the limit.`,
}

/** The plan flags that are booleans rather than ceilings. */
export type FeatureFlag = {
  [K in keyof Plan]: Plan[K] extends boolean ? K : never
}[keyof Plan]

const FEATURE_MESSAGES: Record<FeatureFlag, string> = {
  customBranding:
    'Custom brand colours are part of the Pro plan. The presets are available on every plan — ' +
    'email us and we will turn this on for you.',
}

/**
 * The same funnel as `assertWithinLimit`, for the flags that are on or off.
 *
 * `customBranding` has sat in the plan table since Stage 1 with nothing reading
 * it, which makes it a claim the product does not keep. This is what makes it
 * true — and, like every other limit here, it is lifted by a row update rather
 * than by a deploy, because `planLimits` **is** the upgrade flow.
 *
 * **403, not 402**, for the same reason: there is nothing the caller can pay.
 * The UI keys on `details.limit`.
 */
export function assertFeature(
  organization: { planKey: string; planLimits?: unknown },
  feature: FeatureFlag,
): void {
  const limits = effectiveLimits(organization)
  if (limits[feature] === true) return

  const details: LimitDetails = {
    limit: feature,
    current: 0,
    max: 0,
    planKey: organization.planKey,
  }

  throw ApiError.forbidden(FEATURE_MESSAGES[feature], details)
}

export interface Usage {
  planKey: string
  planLabel: string
  conferences: { current: number; max: number }
  members: { current: number; max: number }
  delegatesPerConference: { max: number }
  committeesPerConference: { max: number }
  customBranding: boolean
}

/**
 * Built now because it powers two things: the limit checks above, and the usage
 * panel on the organisation settings screen. Usage snapshot tables can wait
 * until there is billing to reconcile them against.
 */
export async function computeUsage(
  db: ScopedClient,
  organization: { planKey: string; planLimits?: unknown },
): Promise<Usage> {
  const limits = effectiveLimits(organization)

  const [conferences, members] = await Promise.all([db.conference.count(), db.membership.count()])

  return {
    planKey: organization.planKey,
    planLabel: planFor(organization.planKey).label,
    conferences: { current: conferences, max: limits.maxConferences },
    members: { current: members, max: limits.maxMembers },
    // Per-conference ceilings have no single "current" to show at organisation
    // level. Reported as the ceiling alone rather than invented as a total,
    // which would be a number that means nothing to anybody.
    delegatesPerConference: { max: limits.maxDelegatesPerConference },
    committeesPerConference: { max: limits.maxCommitteesPerConference },
    customBranding: limits.customBranding === true,
  }
}
