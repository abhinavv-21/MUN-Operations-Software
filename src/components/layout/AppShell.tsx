'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { visibleNav } from './navigation.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The operations shell.
 *
 * A sidebar from md up and a tab bar below, both rendered from the same
 * navigation data. The tab bar sits above the safe-area inset so it clears the
 * home indicator on a phone, which is the device this is actually used on
 * during a conference.
 */
export function AppShell({
  orgSlug,
  organizationName,
  userEmail,
  canManageMembers,
  children,
}: {
  orgSlug: string
  organizationName: string
  userEmail: string
  canManageMembers: boolean
  children: ReactNode
}) {
  const pathname = usePathname()
  const items = visibleNav(canManageMembers)

  const isCurrent = (href: string) =>
    href === `/app/${orgSlug}` ? pathname === href : pathname.startsWith(href)

  return (
    <div className="ground-app min-h-dvh md:flex">
      {/* Sidebar */}
      <aside className="hidden w-sidebar shrink-0 border-r border-edge bg-surface md:flex md:flex-col">
        <div className="border-b border-edge px-5 py-4">
          <Link href="/app" className="text-label uppercase text-ink-secondary hover:text-ink">
            All organisations
          </Link>
          <p className="mt-1 truncate font-heading text-h3 text-ink">{organizationName}</p>
        </div>

        <nav aria-label="Sections" className="flex-1 p-3">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const href = item.href(orgSlug)
              const current = isCurrent(href)
              return (
                <li key={item.key}>
                  <Link
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-control px-3 py-2 text-body',
                      'transition-colors duration-micro ease-standard',
                      current
                        ? 'bg-accent-wash text-accent'
                        : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink',
                    )}
                  >
                    <item.icon size={18} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="border-t border-edge p-3">
          <p className="truncate px-3 pb-2 text-body-sm text-ink-tertiary">{userEmail}</p>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className={cn(
                'flex w-full items-center gap-3 rounded-control px-3 py-2 text-body',
                'text-ink-secondary transition-colors duration-micro ease-standard',
                'hover:bg-surface-sunken hover:text-ink',
              )}
            >
              <LogOut size={18} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="flex items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-3 md:hidden">
          <div className="min-w-0">
            <Link href="/app" className="text-label uppercase text-ink-secondary">
              All organisations
            </Link>
            <p className="truncate font-heading text-h3 text-ink">{organizationName}</p>
          </div>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              aria-label="Sign out"
              className="grid size-tap place-items-center rounded-control text-ink-secondary hover:bg-surface-sunken"
            >
              <LogOut size={18} aria-hidden />
            </button>
          </form>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom)+1rem)] md:px-8 md:py-8 md:pb-8">
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
                      'flex h-tabbar flex-col items-center justify-center gap-1 text-label uppercase',
                      current ? 'text-accent' : 'text-ink-secondary',
                    )}
                  >
                    <item.icon size={18} aria-hidden />
                    {item.label}
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
