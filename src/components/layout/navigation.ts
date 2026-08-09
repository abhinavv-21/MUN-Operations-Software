import type { LucideIcon } from 'lucide-react'
import { CalendarDays, LayoutDashboard, Settings, Users } from 'lucide-react'

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
 * notice — which is how Conferences and Settings came out in Stage 3, how
 * Conferences came back in Stage 4, and how Settings came back in Stage 8.
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
  {
    key: 'settings',
    label: 'Settings',
    icon: Settings as LucideIcon,
    href: (orgSlug: string) => `/app/${orgSlug}/settings` as const,
    // Owner or admin, which is a different power from managing members —
    // `canManageMembers` is deliberately off the role axis. Rendered from the
    // role rather than that flag.
    requiresMemberManager: false,
    requiresOrgAdmin: true,
  },
]

export type NavItem = (typeof ORG_NAV)[number]

export function visibleNav(canManageMembers: boolean, isOrgAdmin = false): NavItem[] {
  // Omitted, not disabled. A control someone cannot use is noise, and a
  // disabled one is a promise the product cannot keep.
  return ORG_NAV.filter(
    (item) =>
      (!item.requiresMemberManager || canManageMembers) &&
      (!('requiresOrgAdmin' in item && item.requiresOrgAdmin) || isOrgAdmin),
  )
}
