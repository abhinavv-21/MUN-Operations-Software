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

/**
 * A conference-day write: a check-in, a logistics request, an award.
 *
 * All three invalidate the whole conference subtree, and all three also move the
 * dashboard, which is the screen the numbers are read off. Being precise about
 * which of the six keys each one touches would be an optimisation that has to
 * be revisited every time a screen is added — and the day it is not revisited,
 * the dashboard shows yesterday's attendance to a room full of people who are
 * standing in front of it.
 *
 * The audit log is invalidated too, because every one of these writes a row and
 * an audit viewer that does not show the action you just took reads as broken.
 */
export function invalidateConferenceDay(client: QueryClient, conferenceId: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.conf(conferenceId) })
}

/** A membership change moves the member list and the plan meter. */
export function invalidateMembers(client: QueryClient, orgSlug: string): void {
  void client.invalidateQueries({ queryKey: queryKeys.members(orgSlug) })
  void client.invalidateQueries({ queryKey: queryKeys.invitations(orgSlug) })
  void client.invalidateQueries({ queryKey: queryKeys.usage(orgSlug) })
}
