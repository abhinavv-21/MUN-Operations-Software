import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/product.ts'
import '@/components/marketing/marketing.css'

/**
 * The marketing shell.
 *
 * A route group, so `/` and `/how-it-works` share a header and a footer without
 * either appearing in the URL. Nothing here reads a session or touches the
 * database, which is what keeps them fast enough to be worth measuring — the
 * CSP nonce means they are rendered per request rather than prerendered, so the
 * work they avoid doing is the whole budget.
 *
 * The stylesheet is imported here rather than in `globals.css` so that the
 * marketing rules are in the marketing route group's CSS chunk and the signed-in
 * product never downloads them.
 *
 * No `ThemeStyle` of its own: the root layout has already published the product
 * default, and there is no organisation here to override it with.
 *
 * ## Two things that were wrong and are not now
 *
 * The header and footer were laid out to `max-w-app` (1440) while every page
 * inside them is `max-w-page` (1180), so the wordmark sat 130px to the left of
 * the headline it was supposed to introduce. They share the page container now.
 *
 * And both used `text-ink` / `border-edge` inside `.ground-app`. Those resolve
 * to the right values *on this ground*, which is exactly why it is a bug worth
 * fixing rather than a nit: the ground vocabulary is what makes moving a block
 * onto `.ground-ink` safe, and a block that reads `--color-ink` directly is a
 * block that cannot be moved.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ground-app flex min-h-dvh flex-col">
      <header className="border-b border-hairline">
        <div className="mx-auto flex w-full max-w-page items-center justify-between gap-4 px-5 py-4 md:px-8">
          <Link
            href="/"
            className="flex min-w-0 items-baseline gap-3 rounded-control font-heading text-h2 text-on-ground"
          >
            {PRODUCT_NAME}
            <span className="hidden font-mono text-label uppercase text-on-ground-muted lg:inline">
              Model UN, for the organising committee
            </span>
          </Link>
          <nav aria-label="Marketing" className="flex items-center gap-1 md:gap-2">
            <Button variant="ghost" asChild>
              <Link href="/how-it-works">How it works</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      {/*
        The footer is dark, directly under a saturated conversion band, because
        a page needs a floor. The previous one was a single row of three links
        at 13px that left the page looking like it had been cut off rather than
        finished.
      */}
      <footer className="ground-ink">
        <div className="mx-auto w-full max-w-page px-5 py-14 md:px-8 md:py-16">
          <div className="grid gap-10 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:gap-16">
            <div>
              <p className="font-heading text-h1 text-on-ground">{PRODUCT_NAME}</p>
              <p className="mt-4 max-w-prose text-body text-on-ground-muted">
                Registrations, the country matrix, allocations, the registration desk, logistics,
                attendance and awards — for the people running the conference around the committee
                rooms, across every edition their society has held.
              </p>
            </div>

            <nav aria-label="Footer" className="md:justify-self-end">
              <p className="font-mono text-label uppercase text-on-ground-muted">Elsewhere</p>
              <ul className="mt-4 flex flex-col gap-3 text-body">
                <li>
                  <Link
                    href="/how-it-works"
                    className="rounded-control text-on-ground-muted duration-micro ease-standard hover:text-on-ground"
                  >
                    How it works
                  </Link>
                </li>
                <li>
                  <Link
                    href="/sign-in"
                    className="rounded-control text-on-ground-muted duration-micro ease-standard hover:text-on-ground"
                  >
                    Sign in
                  </Link>
                </li>
                <li>
                  {/* Not a Next route, so a plain anchor. A `Link` to an API
                      path is a prefetch of a JSON body nobody asked for. */}
                  <a
                    href="/api/health"
                    className="rounded-control text-on-ground-muted duration-micro ease-standard hover:text-on-ground"
                  >
                    Service status
                  </a>
                </li>
              </ul>
            </nav>
          </div>

          <div className="mt-12 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-t border-hairline pt-6 font-mono text-label uppercase text-on-ground-muted md:mt-16">
            <p>{PRODUCT_TAGLINE}</p>
            <p>Not a committee tool · Never will be</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
