'use client'

import { useState } from 'react'
import { CloudOff, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'
import { flush } from '@/lib/offline/queue.ts'
import { useOfflineQueue } from '@/lib/offline/use-offline-queue.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The connection pill.
 *
 * Silent when everything is working. That is the whole design: a permanent
 * "online" badge is a thing people stop seeing within an hour, and then the
 * moment it changes to "offline" they do not see that either.
 *
 * It appears for exactly three states, each of which needs a different reaction
 * from the person reading it:
 *
 * - **offline with nothing queued** — carry on, but know that only check-ins
 *   and logistics requests will save;
 * - **writes waiting** — do not close the tab;
 * - **something was refused** — a queued write was rejected by the server and
 *   is gone, which is the only state that needs reading rather than glancing at.
 *
 * Fixed above the tab bar on a phone so it clears the navigation, and bottom
 * right on a desktop where nothing else lives.
 */
export function ConnectionPill() {
  const { pending, flushing, offline, lastDrop } = useOfflineQueue()
  /*
    What was dismissed is stored as the message itself, not as a boolean.

    That makes "has this been dismissed" a comparison rather than a piece of
    state to reset, so a second refusal with a different message reappears on
    its own. The boolean version needs an effect to clear it when `lastDrop`
    changes, which is a `setState` inside `useEffect` — a cascading render, and
    a lint error in this repository for exactly that reason.
  */
  const [dismissedDrop, setDismissedDrop] = useState<string | null>(null)

  const showDrop = lastDrop !== null && lastDrop !== dismissedDrop
  if (!offline && pending === 0 && !showDrop) return null

  const tone = showDrop
    ? 'border-danger bg-danger-wash'
    : pending > 0
      ? 'border-warning bg-warning-wash'
      : 'border-edge-strong bg-surface'

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed z-40 flex items-center gap-3 rounded-pill border px-4 py-2 shadow-overlay',
        'right-4 bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom)+1rem)]',
        'md:bottom-4',
        tone,
      )}
    >
      {showDrop ? (
        <>
          <TriangleAlert size={16} className="shrink-0 text-danger" aria-hidden />
          <span className="max-w-xs text-body-sm text-ink">{lastDrop}</span>
          <Button variant="ghost" size="sm" onClick={() => setDismissedDrop(lastDrop)}>
            Dismiss
          </Button>
        </>
      ) : pending > 0 ? (
        <>
          <CloudOff size={16} className="shrink-0 text-warning" aria-hidden />
          <span className="text-body-sm text-ink">
            {pending} waiting to send{offline ? ' — no connection' : ''}
          </span>
          <Button variant="ghost" size="sm" loading={flushing} onClick={() => void flush()}>
            <RefreshCw size={14} aria-hidden />
            Retry
          </Button>
        </>
      ) : (
        <>
          <WifiOff size={16} className="shrink-0 text-ink-secondary" aria-hidden />
          <span className="text-body-sm text-ink-secondary">
            Offline — check-ins and logistics still save
          </span>
        </>
      )}
    </div>
  )
}
