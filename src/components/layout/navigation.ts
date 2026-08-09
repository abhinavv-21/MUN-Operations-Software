import type { LucideIcon } from 'lucide-react'
import { CalendarDays, LayoutDashboard, Users } from 'lucide-react'

/**
 * Navigation as data, in one file.
 *
 * The shell renders it twice — a sidebar from md up and a tab bar below — and
 * two hand-written copies drift.
 *
 * The `href` builders are deliberately left to inference rather than annotated
 * as `Route`. Next's typed routes describe a path as a template literal type,
 * and widening it to `Route` throws that away — which then makes every `Link`
 * in the shell an error. Inference keeps `/app/${string}/members` intact all
 * the way to the `Link`.
 *
 * Only routes that exist appear here. Typed routes make a link to a page that
 * has not been built a compile error rather than something a person has to
 * notice — which is how Conferences and Settings came out in Stage 3, and how
 * Conferences came back in now that it exists. Settings arrives in Stage 8.
 */
export const ORG_NAV = [
  {
    key: 'overview',
    label: 'Overview',
    icon: LayoutDashboard as LucideIcon,
    href: (orgSlug: string) => `/app/${orgSlug}` as const,
    requiresMemberManager: false,
  },
  {
    key: 'conferences',
    label: 'Conferences',
    icon: CalendarDays as LucideIcon,
    href: (orgSlug: string) => `/app/${orgSlug}/conferences` as const,
    requiresMemberManager: false,
  },
  {
    key: 'members',
    label: 'Members',
    icon: Users as LucideIcon,
    href: (orgSlug: string) => `/app/${orgSlug}/members` as const,
    requiresMemberManager: true,
  },
]

export type NavItem = (typeof ORG_NAV)[number]

export function visibleNav(canManageMembers: boolean): NavItem[] {
  // Omitted, not disabled. A control someone cannot use is noise, and a
  // disabled one is a promise the product cannot keep.
  return ORG_NAV.filter((item) => !item.requiresMemberManager || canManageMembers)
}
