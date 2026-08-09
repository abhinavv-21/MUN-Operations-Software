/**
 * Every model in the schema is classified here, into exactly one bucket.
 *
 * This file is the reason the tenancy guarantee survives contact with a schema
 * that keeps growing. The scoping extension alone is not enough: a model added
 * in six months would simply not be in any list, and would be silently
 * unscoped forever. `models.coverage.test.ts` reads the generated client's
 * model registry and fails until every model appears here, so adding a table
 * without deciding how it is scoped breaks CI rather than production.
 */

/**
 * Scoped by `conferenceId`. Everything operational lives here.
 *
 * A read on one of these without a conference in scope throws rather than
 * returning every tenant's rows.
 */
export const TENANT_MODELS = [
  'Committee',
  'CommitteeCountry',
  'ConferenceRole',
  'Registration',
  'Delegate',
  'ConferenceIntegration',
  'Assignment',
  'AttendanceRecord',
  'LogisticsRequest',
  'Award',
] as const

/**
 * Conference-scoped models that may also be *read* with only an organisation in
 * scope, filtered through their `conference` relation.
 *
 * This exists for exactly one shape of question: "what can this user reach in
 * this organisation", which the conference switcher asks on every page and
 * which has no single conference to be scoped to. Answering it without this
 * would mean one query per conference.
 *
 * Deliberately narrow, for two reasons.
 *
 * Reads only. A write still needs a conference in scope, so nothing can be
 * created or modified across conferences by accident.
 *
 * Membership tables only. `Committee` is *not* in here and must not be: an
 * organiser with a grant on MUN XI and none on MUN X should not be able to read
 * MUN X's operational data, and keeping operational models hard-bounded to one
 * conference is what makes that a property of the database rather than a
 * promise made by a service.
 */
export const ORG_REACHABLE_MODELS = ['ConferenceRole'] as const

/**
 * Org-reachable models that may also be **deleted in bulk** with only an
 * organisation in scope, filtered through their `conference` relation.
 *
 * One model, one operation — `deleteMany` — and it exists for exactly one
 * action: removing somebody from the organisation.
 *
 * That action is inherently organisation-wide. A person leaving takes their
 * grants on every conference with them, and the alternative to allowing this is
 * worse than the rule it bends: leaving the rows behind means re-inviting
 * somebody silently restores access they used to have, which is a security bug
 * dressed as tidiness. Doing it one conference at a time outside the
 * transaction is worse again — a failure halfway leaves the membership deleted
 * and the grants live.
 *
 * Named as its own list rather than folded into `ORG_REACHABLE_MODELS` because
 * the narrowness *is* the design:
 *
 * - **`deleteMany` only.** No create, no update, no `updateMany`. Nothing here
 *   can write a value across conferences, only revoke.
 * - **Still filtered by organisation.** The injected clause is
 *   `{ conference: { organizationId } }`, so this cannot reach another tenant's
 *   grants any more than a read can.
 * - **Membership tables only**, for the same reason `ORG_REACHABLE_MODELS` is:
 *   an operational model must stay hard-bounded to one conference.
 *
 * This was added in Stage 7 after `removeMember` was found to answer 500 on its
 * success path — see docs/07-TRAPS.md.
 */
export const ORG_REVOCABLE_MODELS = ['ConferenceRole'] as const

/**
 * Scoped by `organizationId`. Membership, tenancy and the audit trail.
 *
 * `Conference` belongs here rather than in TENANT_MODELS because it *is* the
 * conference boundary; scoping it by itself is circular. `AuditLog` belongs
 * here because an organisation-level action — inviting a member, transferring
 * ownership — has no conference to be filed under.
 */
export const ORG_MODELS = ['Membership', 'Conference', 'Invitation', 'AuditLog'] as const

/**
 * Deliberately unscoped, and each one needs a reason.
 *
 * `Organization`: resolving one is how a request discovers its tenant, so
 * scoping it by itself is circular. Access is gated by membership in
 * `createCtx`, not by row filtering.
 *
 * `User`: identity spans organisations. One person may belong to several, and
 * the same account must work in all of them.
 */
export const GLOBAL_MODELS = ['Organization', 'User'] as const

export type TenantModel = (typeof TENANT_MODELS)[number]
export type OrgModel = (typeof ORG_MODELS)[number]
export type GlobalModel = (typeof GLOBAL_MODELS)[number]

const tenantSet: ReadonlySet<string> = new Set(TENANT_MODELS)
const orgSet: ReadonlySet<string> = new Set(ORG_MODELS)
const globalSet: ReadonlySet<string> = new Set(GLOBAL_MODELS)
const orgReachableSet: ReadonlySet<string> = new Set(ORG_REACHABLE_MODELS)
const orgRevocableSet: ReadonlySet<string> = new Set(ORG_REVOCABLE_MODELS)

export function isOrgReachableModel(model: string): boolean {
  return orgReachableSet.has(model)
}

export function isOrgRevocableModel(model: string): boolean {
  return orgRevocableSet.has(model)
}

export function isTenantModel(model: string): boolean {
  return tenantSet.has(model)
}

export function isOrgModel(model: string): boolean {
  return orgSet.has(model)
}

export function isGlobalModel(model: string): boolean {
  return globalSet.has(model)
}

/** Every classified model name, for the coverage test. */
export const CLASSIFIED_MODELS: readonly string[] = [
  ...TENANT_MODELS,
  ...ORG_MODELS,
  ...GLOBAL_MODELS,
]
