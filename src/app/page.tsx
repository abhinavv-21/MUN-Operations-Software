import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { PRODUCT_NAME } from '@/lib/product.ts'

/**
 * A holding page until Stage 8 builds the marketing site.
 *
 * Deliberately one screen and one action: this is what someone arriving at the
 * bare domain sees, and the only thing they can usefully do today is sign in.
 * Anything more would be a pitch for features that are still being built.
 */
export default function HomePage() {
  return (
    <main className="ground-app grid min-h-dvh place-items-center px-5 py-16">
      <div className="w-full max-w-prose">
        <p className="text-label uppercase text-ink-secondary">Model UN, run properly</p>
        <h1 className="mt-3 font-heading text-display text-ink">{PRODUCT_NAME}</h1>
        <span className="page-rule mt-4" aria-hidden />

        <p className="mt-6 text-body text-ink-secondary">
          Committees, delegates, the country matrix, allocations, logistics, attendance and awards —
          for one conference or for every edition your society has ever run.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/sign-in">
              Sign in
              <ArrowRight size={16} aria-hidden />
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/api/health">Service status</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
