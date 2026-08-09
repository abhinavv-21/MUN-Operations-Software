import Link from 'next/link'
import type { Metadata } from 'next'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { PRODUCT_NAME } from '@/lib/product.ts'

export const metadata: Metadata = { title: 'Not found' }

/**
 * The 404.
 *
 * This is not a decorative page. It is where a **printed QR code lands** after
 * an organisation changes its address — the change the settings screen itself
 * warns about — and where a delegate arrives when a registration link is
 * mistyped off a poster. Until now it was Next's bare "This page could not be
 * found", with no product name, no explanation and nowhere to go.
 *
 * It is also what a stranger sees when they guess an organisation slug, because
 * a non-member gets `notFound()` rather than a 403: whether `harvard` is a
 * customer is not something the URL bar should answer. So the copy cannot
 * distinguish "does not exist" from "not yours", and deliberately does not try.
 */
export default function NotFound() {
  return (
    <main className="ground-app grid min-h-dvh place-items-center px-5 py-16">
      <div className="w-full max-w-prose text-center">
        <Compass size={32} className="mx-auto text-ink-tertiary" aria-hidden />

        <h1 className="mt-5 font-heading text-h1 text-ink">There is nothing at this address</h1>
        <span className="page-rule mx-auto mt-4" aria-hidden />

        <p className="mt-6 text-body text-ink-secondary">
          The link may be mistyped, or the conference it pointed at may have moved. If you were
          given this address on a poster or a form, the society that runs the conference will have
          the current one.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/">Go to {PRODUCT_NAME}</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/app">Your organisations</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
