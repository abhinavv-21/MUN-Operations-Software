import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, Users } from 'lucide-react'

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
 * Only routes that exist appear here, which is how Conferences and Settings
 * came back out: they arrive in Stage 4 and Stage 8, and until then a nav item
 * pointing at them is a link to a 404. Typed routes make that a compile error
 * rather than something a person has to notice.
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
