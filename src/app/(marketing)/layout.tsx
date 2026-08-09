import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button.tsx'
import { PRODUCT_NAME } from '@/lib/product.ts'

/**
 * The marketing shell.
 *
 * A route group, so `/` and `/how-it-works` share a header and a footer without
 * either appearing in the URL. Nothing here reads a session or touches the
 * database, which is what keeps them fast enough to be worth measuring — the
 * CSP nonce means they are rendered per request rather than prerendered, so the
 * work they avoid doing is the whole budget.
 *
 * No `ThemeStyle` of its own: the root layout has already published the product
 * default, and there is no organisation here to override it with.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ground-app flex min-h-dvh flex-col">
      <header className="border-b border-edge">
        <div className="mx-auto flex w-full max-w-app items-center justify-between gap-4 px-5 py-4 md:px-8">
          <Link href="/" className="min-w-0 font-heading text-h3 text-ink">
            {PRODUCT_NAME}
          </Link>
          <nav aria-label="Marketing" className="flex items-center gap-2">
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

      <footer className="border-t border-edge">
        <div className="mx-auto flex w-full max-w-app flex-wrap items-center justify-between gap-3 px-5 py-6 text-body-sm text-ink-secondary md:px-8">
          <p>{PRODUCT_NAME}</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/how-it-works" className="hover:text-ink">
              How it works
            </Link>
            <Link href="/sign-in" className="hover:text-ink">
              Sign in
            </Link>
            {/* Not a Next route, so a plain anchor. A `Link` to an API path is
                a prefetch of a JSON body nobody asked for. */}
            <a href="/api/health" className="hover:text-ink">
              Service status
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
