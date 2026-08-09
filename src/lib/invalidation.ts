import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from './query-keys.ts'

/**
 * The invalidation fan-out, in one file.
 *
 * This exists for the reason the reference product gives: a delegate carries an
 * allocation, and an allocation changes four other screens. Writing the
 * invalidations at each call site means the day someone adds a fifth screen,
 * four of the five call sites get updated and nobody notices the one that did
 * not — the dashboard quietly shows a stale count for a week.
 *
 * One function per kind of write. Components call these and never
 * `queryClient.invalidateQueries` directly.
 */

/** A new conference, or a change to one, changes the organisation's lists. */
export function invalidateConferences(client: QueryClient, orgSlug: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.conferences(orgSlug) })
  // Usage counts conferences, so creating one moves the plan meter too.
  void client.invalidateQueries({ queryKey: queryKeys.usage(orgSlug) })
}

export function invalidateConference(
  client: QueryClient,
  orgSlug: string,
  conferenceId: string,
): void {
  void client.invalidateQueries({ queryKey: queryKeys.conference(conferenceId) })
  // The list carries the name and dates, so it goes stale with the detail.
  void client.invalidateQueries({ queryKey: queryKeys.conferences(orgSlug) })
}

/**
 * A committee write.
 *
 * Invalidates the whole conference subtree rather than the committee list
 * alone: committees carry seat capacity, which the matrix, the allocations
 * screen and the dashboard all read. Being precise here would be an
 * optimisation that has to be revisited every time a screen is added.
 */
export function invalidateCommittees(
  client: QueryClient,
  orgSlug: string,
  conferenceId: string,
): void {
  void client.invalidateQueries({ queryKey: queryKeys.conf(conferenceId) })
  void client.invalidateQueries({ queryKey: queryKeys.conferences(orgSlug) })
}

/** A membership change moves the member list and the plan meter. */
export function invalidateMembers(client: QueryClient, orgSlug: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.members(orgSlug) })
  void client.invalidateQueries({ queryKey: queryKeys.invitations(orgSlug) })
  void client.invalidateQueries({ queryKey: queryKeys.usage(orgSlug) })
}
