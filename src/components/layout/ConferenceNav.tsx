'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { visibleConferenceNav } from './conference-navigation.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The strip of sections inside one conference.
 *
 * Horizontally scrollable on a phone rather than wrapped onto three lines or
 * collapsed behind a menu. Nine sections is too many for a tab bar and a menu
 * costs a tap on every navigation — during a conference someone moves between
 * attendance and logistics dozens of times an hour, and the scroll strip is the
 * only one of the three that keeps both one tap away.
 */
export function ConferenceNav({
  orgSlug,
  conferenceId,
  isAdmin,
}: {
  orgSlug: string
  conferenceId: string
  isAdmin: boolean
}) {
  const pathname = usePathname()
  const items = visibleConferenceNav(isAdmin)

  return (
    <nav aria-label="Conference sections" className="-mx-4 mb-6 md:mx-0">
      <ul className="table-scroll flex gap-1 px-4 pb-1 md:px-0">
        {items.map((item) => {
          const href = item.href(orgSlug, conferenceId)
          const current = item.exact ? pathname === href : pathname.startsWith(href)

          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-control px-3 py-2',
                  'text-body-sm transition-colors duration-micro ease-standard',
                  current
                    ? 'bg-accent-wash text-accent'
                    : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
                )}
              >
                <item.icon size={16} aria-hidden />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
