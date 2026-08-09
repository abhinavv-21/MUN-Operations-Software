'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ChevronLeft, LogOut } from 'lucide-react'
import { visibleNav } from './navigation.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The operations shell.
 *
 * A sidebar from md up and a tab bar below, both rendered from the same
 * navigation data. The tab bar sits above the safe-area inset so it clears the
 * home indicator on a phone, which is the device this is actually used on
 * during a conference.
 *
 * The shell is drawn on `surface` while the page it frames is on `canvas`. That
 * is the wrong way round from most admin products and deliberate here: the
 * canvas is where a 96-row table lives, and the chrome should be the calmer of
 * the two rather than a dark rail competing with it at 08:40.
 */
export function AppShell({
  orgSlug,
  organizationName,
  userEmail,
  canManageMembers,
  isOrgAdmin,
  children,
  currentPath,
}: {
  orgSlug: string
  organizationName: string
  userEmail: string
  canManageMembers: boolean
  isOrgAdmin: boolean
  children: ReactNode
  /**
   * Overrides the live pathname. Only the development preview passes it — the
   * shell's active state is most of its design and cannot be reviewed on a
   * route the navigation does not contain.
   */
  currentPath?: string
}) {
  const livePath = usePathname()
  const pathname = currentPath ?? livePath
  const items = visibleNav(canManageMembers, isOrgAdmin)

  const isCurrent = (href: string) =>
    href === `/app/${orgSlug}` ? pathname === href : pathname.startsWith(href)

  return (
    <div className="ground-app min-h-dvh md:flex">
      {/* Sidebar */}
      <aside className="hidden w-sidebar shrink-0 border-r border-edge bg-surface md:flex md:flex-col">
        {/*
          `px-7` is 28px, which is where the navigation icons below start
          (`p-3` on the nav plus `pl-4` on the link). The organisation name and
          the section labels share one left edge instead of sitting 16px apart
          for no reason, and the back link hangs its chevron into the margin so
          its text lands on that edge too.
        */}
        <div className="border-b border-edge px-7 py-4">
          <Link
            href="/app"
            className={cn(
              '-ml-4 inline-flex items-center gap-1 py-0.5',
              'text-label uppercase text-ink-secondary',
              'transition-colors duration-micro ease-standard hover:text-ink',
            )}
          >
            <ChevronLeft size={13} aria-hidden />
            All organisations
          </Link>
          <p className="mt-0.5 truncate font-heading text-h2 text-ink" title={organizationName}>
            {organizationName}
          </p>
        </div>

        <nav aria-label="Sections" className="flex-1 p-3">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => {
              const href = item.href(orgSlug)
              const current = isCurrent(href)
              return (
                <li key={item.key}>
                  <Link
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'relative flex min-h-9 items-center gap-3 rounded-control py-2 pl-4 pr-3 text-body',
                      'transition-colors duration-micro ease-standard',
                      current
                        ? 'bg-accent-wash font-medium text-accent'
                        : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
                    )}
                  >
                    {/*
                      A 2px accent stem inside the left edge of the pill.

                      The wash alone is a very pale tint — by construction, it
                      is the accent at 0.97 lightness — and on a slate or navy
                      seed it is close enough to `surface-sunken` that the
                      current section and a hovered one looked the same. The
                      stem is full-strength accent and settles it at a glance.
                    */}
                    {current ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-1.5 left-1 w-0.5 rounded-pill bg-accent"
                      />
                    ) : null}
                    <item.icon size={18} className="shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="border-t border-edge p-3">
          <p className="truncate px-4 pb-1.5 text-body-sm text-ink-secondary" title={userEmail}>
            {userEmail}
          </p>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className={cn(
                'flex min-h-9 w-full items-center gap-3 rounded-control py-2 pl-4 pr-3 text-body',
                'text-ink-secondary transition-colors duration-micro ease-standard',
                'hover:bg-surface-sunken hover:text-ink',
              )}
            >
              <LogOut size={18} className="shrink-0" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Mobile header.

          One row of three real 48px targets rather than a stacked block. The
          back link used to be an 11px line of uppercase text above the
          organisation name — a 15px-tall tap target on the device this product
          is used on, which is both a miss for anyone with cold hands at a
          registration desk and a straight failure of the 48px floor the rest of
          the kit holds. As a chevron it is the size it should be, the
          organisation name gets the full width it wants, and the header is
          shorter, which buys a row and a half of table back.
        */}
        <header className="flex items-center gap-1 border-b border-edge bg-surface px-2 py-1 md:hidden">
          <Link
            href="/app"
            aria-label="All organisations"
            className={cn(
              'grid size-tap shrink-0 place-items-center rounded-control text-ink-secondary',
              'transition-colors duration-micro ease-standard hover:bg-surface-sunken hover:text-ink',
            )}
          >
            <ChevronLeft size={20} aria-hidden />
          </Link>
          <p className="min-w-0 flex-1 truncate font-heading text-h3 text-ink">
            {organizationName}
          </p>
          <form action="/auth/sign-out" method="post" className="shrink-0">
            <button
              type="submit"
              aria-label="Sign out"
              className={cn(
                'grid size-tap place-items-center rounded-control text-ink-secondary',
                'transition-colors duration-micro ease-standard hover:bg-surface-sunken hover:text-ink',
              )}
            >
              <LogOut size={18} aria-hidden />
            </button>
          </form>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom)+1.5rem)] md:px-8 md:py-8 md:pb-8">
          <div className="mx-auto w-full max-w-app">{children}</div>
        </main>

        {/* Tab bar */}
        <nav
          aria-label="Sections"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <ul className="flex">
            {items.map((item) => {
              const href = item.href(orgSlug)
              const current = isCurrent(href)
              return (
                <li key={item.key} className="flex-1">
                  <Link
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex h-tabbar flex-col items-center justify-center gap-1 px-1 text-label uppercase',
                      'transition-colors duration-micro ease-standard',
                      current ? 'text-accent' : 'text-ink-secondary',
                    )}
                  >
                    {/*
                      The wash sits behind the icon rather than behind the whole
                      tab. A four-up tab bar has no room for a full-width pill,
                      and colouring the label alone is a 11px cue to find while
                      walking — the filled lozenge is visible without reading.
                    */}
                    <span
                      className={cn(
                        'grid h-6 w-10 place-items-center rounded-pill',
                        'transition-colors duration-micro ease-standard',
                        current ? 'bg-accent-wash' : 'bg-transparent',
                      )}
                    >
                      <item.icon size={18} aria-hidden />
                    </span>
                    <span className="max-w-full truncate">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </div>
  )
}
