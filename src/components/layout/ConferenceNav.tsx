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
 *
 * Underlined tabs rather than filled pills, for two reasons.
 *
 * The sidebar already uses a washed pill for "you are here", and the same mark
 * appearing twice on one screen at two different levels of the hierarchy reads
 * as two things of equal rank. An underline is a different kind of mark, so the
 * strip is obviously subordinate to the rail.
 *
 * And the strip needs a floor. As pills it floated between the conference name
 * above and the first card below with nothing to say which it belonged to; the
 * rule the tabs sit on separates the chrome from the page in one line.
 */
/**
 * The same CSS-only scroll shadows the data table uses, in the canvas colour
 * because the strip sits on the page rather than on a card.
 *
 * Ten sections do not fit on a 390px screen and the tenth was simply sliced off
 * at the edge. The shadow appears only while there is something past it, and
 * disappears on a laptop where the whole strip fits.
 */
const SCROLL_SHADOWS = {
  background: [
    'linear-gradient(to right, var(--color-canvas) 45%, transparent) 0 0 / 28px 100% no-repeat local',
    'linear-gradient(to left, var(--color-canvas) 45%, transparent) 100% 0 / 28px 100% no-repeat local',
    'linear-gradient(to right, color-mix(in oklab, var(--color-ink) 14%, transparent), transparent) 0 0 / 14px 100% no-repeat scroll',
    'linear-gradient(to left, color-mix(in oklab, var(--color-ink) 14%, transparent), transparent) 100% 0 / 14px 100% no-repeat scroll',
    'var(--color-canvas)',
  ].join(','),
}

export function ConferenceNav({
  orgSlug,
  conferenceId,
  isAdmin,
  currentPath,
}: {
  orgSlug: string
  conferenceId: string
  isAdmin: boolean
  /** Overrides the live pathname. Only the development preview passes it. */
  currentPath?: string
}) {
  const livePath = usePathname()
  const pathname = currentPath ?? livePath
  const items = visibleConferenceNav(isAdmin)

  return (
    <nav aria-label="Conference sections" className="-mx-4 mb-5 md:mx-0 md:mb-6">
      <ul style={SCROLL_SHADOWS} className="table-scroll flex gap-1 border-b border-edge px-4 md:px-0">
        {items.map((item) => {
          const href = item.href(orgSlug, conferenceId)
          const current = item.exact ? pathname === href : pathname.startsWith(href)

          return (
            <li key={item.key} className="shrink-0">
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  // `-mb-px` drops the tab's own border onto the strip's
                  // hairline instead of stacking a second line above it.
                  'flex min-h-tap items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-px -mb-px md:min-h-10',
                  'text-body-sm transition-colors duration-micro ease-standard',
                  current
                    ? 'border-accent font-medium text-ink'
                    : 'border-transparent text-ink-secondary hover:border-edge-strong hover:text-ink',
                )}
              >
                <item.icon
                  size={16}
                  className={cn('shrink-0', current ? 'text-accent' : '')}
                  aria-hidden
                />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
