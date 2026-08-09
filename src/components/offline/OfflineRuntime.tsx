'use client'

import { useEffect, useState } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { startQueue } from '@/lib/offline/queue.ts'
import { ConnectionPill } from './ConnectionPill.tsx'

/**
 * Everything the app needs running in the background on conference day, in one
 * mount point.
 *
 * One component rather than three, because all three have to be inside the
 * organisation layout — below the theme, above the pages — and three separate
 * mounts is three places to forget one.
 */
export function OfflineRuntime() {
  useEffect(() => startQueue(), [])

  return (
    <>
      <ConnectionPill />
      <UpdatePrompt />
    </>
  )
}

/**
 * "A new version is ready."
 *
 * Appears when a new service worker has installed and is waiting, which happens
 * when `CACHE_VERSION` in `public/sw.js` changes. It is a prompt and not an
 * automatic reload on purpose: taking the page away from someone mid-check-in
 * to apply an update loses whatever they were typing, and the update has waited
 * this long already.
 *
 * Registration is production-only. In development Next serves unhashed,
 * frequently-changing chunks, and a worker caching those turns every edit into
 * a hard-refresh hunt.
 */
function UpdatePrompt() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    let cancelled = false

    const track = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        setWaiting(registration.waiting)
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // A worker reaching `installed` while one is already controlling the
          // page is an update. The same transition with no controller is the
          // very first install, which is not something to prompt about.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing)
          }
        })
      })
    }

    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        if (!cancelled) track(registration)
      })
      .catch(() => {
        // A failed registration is not worth telling anyone about: the app
        // works without it, only the offline shell does not.
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!waiting) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 border-b border-edge bg-accent-wash px-4 py-2"
    >
      <ArrowUpCircle size={16} className="text-accent" aria-hidden />
      <span className="text-body-sm text-ink">A newer version of this page is ready.</span>
      <Button
        size="sm"
        onClick={() => {
          // Reload once the new worker takes control, not immediately: reloading
          // first just loads the old one again.
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            () => window.location.reload(),
            { once: true },
          )
          waiting.postMessage('SKIP_WAITING')
        }}
      >
        Reload
      </Button>
    </div>
  )
}
