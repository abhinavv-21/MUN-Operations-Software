/**
 * Query keys, namespaced by conference.
 *
 * The reference product's keys are flat and start with the domain —
 * `['delegates', filters]` — because it serves exactly one conference. Here the
 * conference has to be in the key, or switching conferences shows the previous
 * one's rows out of the cache until a refetch lands.
 *
 * Every key is built here rather than inline at call sites, so the invalidation
 * fan-out in `invalidation.ts` can be written against something that cannot
 * silently disagree with what a component asked for.
 */

export const queryKeys = {
  organizations: () => ['orgs'] as const,

  org: (orgSlug: string) => ['org', orgSlug] as const,
  members: (orgSlug: string) => ['org', orgSlug, 'members'] as const,
  invitations: (orgSlug: string) => ['org', orgSlug, 'invitations'] as const,
  usage: (orgSlug: string) => ['org', orgSlug, 'usage'] as const,
  conferences: (orgSlug: string) => ['org', orgSlug, 'conferences'] as const,

  conf: (conferenceId: string) => ['conf', conferenceId] as const,
  conference: (conferenceId: string) => ['conf', conferenceId, 'detail'] as const,
  committees: (conferenceId: string) => ['conf', conferenceId, 'committees'] as const,
  countries: (conferenceId: string, committeeId: string) =>
    ['conf', conferenceId, 'committees', committeeId, 'countries'] as const,

  /** Filtered lists carry their filters, so a search does not evict the base list. */
  delegates: (conferenceId: string, filters: Record<string, unknown> = {}) =>
    ['conf', conferenceId, 'delegates', filters] as const,

  dashboard: (conferenceId: string) => ['conf', conferenceId, 'dashboard'] as const,
  /** The register is per day, so switching day is a different query and not a refetch. */
  attendance: (conferenceId: string, filters: Record<string, unknown> = {}) =>
    ['conf', conferenceId, 'attendance', filters] as const,
  logistics: (conferenceId: string, filters: Record<string, unknown> = {}) =>
    ['conf', conferenceId, 'logistics', filters] as const,
  awards: (conferenceId: string) => ['conf', conferenceId, 'awards'] as const,
  auditLog: (conferenceId: string, filters: Record<string, unknown> = {}) =>
    ['conf', conferenceId, 'audit', filters] as const,
}
