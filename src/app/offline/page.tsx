import type { Metadata } from 'next'
import { WifiOff } from 'lucide-react'
import { PRODUCT_NAME } from '@/lib/product.ts'

export const metadata: Metadata = { title: 'Offline' }

/**
 * What the service worker serves when a navigation fails.
 *
 * Static, and it has to stay that way: it is cached at install time and
 * rendered with no network and no JavaScript hydration to speak of. It says the
 * one thing worth knowing — the two writes that still work — because the whole
 * point of the offline design is that being offline is not the same as being
 * stopped.
 */
export default function OfflinePage() {
  return (
    <main className="ground-app grid min-h-dvh place-items-center px-6 py-16">
      <div className="max-w-prose text-center">
        <WifiOff size={36} className="mx-auto text-ink-tertiary" aria-hidden />
        <h1 className="mt-5 text-h1 text-ink">No connection</h1>
        <p className="mt-3 text-body text-ink-secondary">
          This page could not be loaded because {PRODUCT_NAME} could not be reached. Nothing has
          been lost.
        </p>
        <p className="mt-4 text-body text-ink-secondary">
          Screens you already have open still work. Attendance check-ins and logistics requests made
          there are saved on this device and sent as soon as the connection comes back. Everything
          else will tell you it could not save rather than pretending it did.
        </p>
        <p className="mt-6 text-body-sm text-ink-secondary">
          Reload once you are back on the network.
        </p>
      </div>
    </main>
  )
}
