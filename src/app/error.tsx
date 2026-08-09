'use client'

import { useEffect } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'

/**
 * What a thrown Server Component renders instead of Next's default.
 *
 * The realistic cause is the database being unreachable, and the realistic time
 * is 08:40 on the morning of a conference. Next's own screen says "Application
 * error: a client-side exception has occurred" and offers nothing; this says
 * what to do, and — importantly — says what is *not* lost, because the first
 * thought of somebody who has just checked forty delegates in is that they have
 * lost forty check-ins.
 *
 * It must be a Client Component: `reset()` is a function React hands it, and the
 * whole point is the retry.
 *
 * It deliberately does not print `error.message`. A Server Component error can
 * carry a connection string, and the same reasoning that makes
 * `EXPOSE_ERROR_DETAILS` fail closed in the API applies to a rendered page. The
 * digest is enough to find it in the logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Server-side errors are already logged where they were thrown. This is the
    // client half, and without it a hydration-time failure leaves no trace at
    // all.
    console.error('[app] render failed', error)
  }, [error])

  return (
    <main className="ground-app grid min-h-dvh place-items-center px-5 py-16">
      <div className="w-full max-w-prose">
        <TriangleAlert size={32} className="text-danger" aria-hidden />

        <h1 className="mt-5 font-heading text-h1 text-ink">This screen did not load</h1>
        <span className="page-rule mt-4" aria-hidden />

        <p className="mt-6 text-body text-ink-secondary">
          Something went wrong on our side, not yours. Nothing you had already saved has been lost —
          and any check-in or logistics request made without a connection is still on this device
          and will send when the page recovers.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button onClick={reset}>
            <RefreshCw size={16} aria-hidden />
            Try again
          </Button>
          <a
            href="/api/health"
            className="text-body-sm text-ink-secondary underline underline-offset-4 hover:text-ink"
          >
            Check whether the service is up
          </a>
        </div>

        {error.digest ? (
          <p className="mt-8 font-mono text-data text-ink-tertiary">
            Reference {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  )
}
