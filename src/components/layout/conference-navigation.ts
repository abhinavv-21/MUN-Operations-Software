import type { LucideIcon } from 'lucide-react'
import {
  Award,
  ClipboardCheck,
  Download,
  Gauge,
  Inbox,
  LayoutGrid,
  ScrollText,
  SlidersHorizontal,
  Users,
  Wrench,
} from 'lucide-react'

/**
 * The conference sub-navigation, as data.
 *
 * Same reasoning as `navigation.ts`: the bar is rendered twice — a scrolling
 * strip on a phone and a row on a desktop — and two hand-written copies drift.
 *
 * `href` builders are left to inference rather than annotated as `Route`.
 * Widening a typed route to `Route` throws away the template literal type and
 * makes every `Link` an error.
 *
 * `adminOnly` mirrors the service layer; it is not the authorization. The
 * services decide, and a CONTRIBUTOR who types the URL of the awards screen
 * still gets a 403 from `requireConferenceAdmin`. This only decides what is
 * worth showing — a control someone cannot use is noise.
 */
export const CONFERENCE_NAV = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: Gauge as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}` as const,
    adminOnly: false,
    exact: true,
  },
  {
    key: 'attendance',
    label: 'Attendance',
    icon: ClipboardCheck as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/attendance` as const,
    adminOnly: false,
    exact: false,
  },
  {
    key: 'logistics',
    label: 'Logistics',
    icon: Wrench as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/logistics` as const,
    adminOnly: false,
    exact: false,
  },
  {
    key: 'committees',
    label: 'Committees',
    icon: LayoutGrid as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/committees` as const,
    adminOnly: false,
    exact: false,
  },
  {
    key: 'delegates',
    label: 'Delegates',
    icon: Users as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/delegates` as const,
    adminOnly: false,
    exact: false,
  },
  {
    key: 'registrations',
    label: 'Registrations',
    icon: Inbox as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/registrations` as const,
    adminOnly: false,
    exact: false,
  },
  {
    key: 'awards',
    label: 'Awards',
    icon: Award as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/awards` as const,
    adminOnly: true,
    exact: false,
  },
  {
    key: 'exports',
    label: 'Exports',
    icon: Download as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/exports` as const,
    adminOnly: true,
    exact: false,
  },
  {
    key: 'audit',
    label: 'Audit log',
    icon: ScrollText as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/audit` as const,
    adminOnly: true,
    exact: false,
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: SlidersHorizontal as LucideIcon,
    href: (orgSlug: string, conferenceId: string) =>
      `/app/${orgSlug}/conferences/${conferenceId}/settings` as const,
    adminOnly: true,
    exact: false,
  },
]

export type ConferenceNavItem = (typeof CONFERENCE_NAV)[number]

export function visibleConferenceNav(isAdmin: boolean): ConferenceNavItem[] {
  return CONFERENCE_NAV.filter((item) => !item.adminOnly || isAdmin)
}
