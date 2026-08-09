import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Lock, RefreshCw, WifiOff } from 'lucide-react'
import { Button } from './Button.tsx'
import { CELL_X } from './DataTable.tsx'
import { cn } from '@/lib/utils.ts'

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Skeleton rows match the final row height, so data landing never shifts the
 * layout. A centred spinner for table content is forbidden: it tells you
 * something is happening and nothing about what is arriving.
 *
 * "Match" is now literal. The row height and the horizontal insets are the same
 * `--spacing-row` and the same `CELL_X` the real `DataTable` uses, imported
 * rather than retyped, so the two cannot drift apart the next time either is
 * touched. The header band is drawn too — otherwise the table grows a 44px
 * strip at the top the instant the data lands, which is the exact layout shift
 * this component exists to prevent.
 *
 * The last bar is pushed right because the last column of nearly every table in
 * this product is a count or a row of actions. A skeleton that predicts the
 * wrong shape is a worse promise than no skeleton.
 */
export function SkeletonRows({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className={cn(CELL_X, 'flex h-11 items-center border-b border-edge-strong bg-surface-sunken')}>
        <div className="skeleton h-2 w-16" />
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className={cn(
            CELL_X,
            'flex h-row-mobile items-center gap-4 border-b border-edge last:border-b-0 md:h-row',
          )}
        >
          {Array.from({ length: columns }, (_, columnIndex) => (
            <div
              key={columnIndex}
              className={cn('skeleton h-3.5', columnIndex === columns - 1 ? 'ml-auto' : '')}
              style={{
                width: columnIndex === 0 ? '26%' : `${Math.max(10, 18 - columnIndex * 2)}%`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Matches `Stat`: same padding, same label width, same 40px number. */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="rounded-card border border-edge bg-surface shadow-raised p-4 md:p-5"
        >
          <div className="skeleton h-2.5 w-20" />
          <div className="skeleton mt-3 h-8 w-14" />
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Empty                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * An empty screen is an invitation to act, so it always offers the action.
 *
 * Two fixes over the obvious version. The icon sits in a sunken tile instead of
 * floating as a lone 32px glyph in the middle of a large white card — a shape
 * to look at rather than a mark somebody forgot to delete. And the sentence is
 * held to a short measure: it was `max-w-prose`, which is 68 characters, so on
 * a 1440px screen a one-line explanation was centred across 640px of card and
 * read as a caption for nothing.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      <span
        aria-hidden
        className="grid size-12 place-items-center rounded-card border border-edge bg-surface-sunken text-ink-secondary"
      >
        <Icon size={22} />
      </span>
      <h3 className="mt-4 text-h3 text-balance text-ink">{title}</h3>
      <p className="mt-1.5 max-w-[42ch] text-balance text-body-sm text-ink-secondary">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Error                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Errors explain what happened and what to do. They do not apologise and they
 * are never vague.
 *
 * `offline` gets its own icon and heading because "check your connection" and
 * "this failed" call for different actions from the reader.
 *
 * `title` exists because this is the only error surface in the product and it
 * is not only used for reads. The default — "Could not load this" — is right
 * under a table that failed to arrive and wrong under a button you just
 * pressed: approving a registration and being told the page could not be loaded
 * is the action and its outcome describing two different events. A write should
 * pass what it was trying to do ("Could not approve this registration").
 * `offline` still overrides it, because when nothing was sent, what you were
 * sending is the second thing you need to know.
 */
export function ErrorState({
  message,
  title = 'Could not load this',
  offline = false,
  onRetry,
}: {
  message: string
  title?: string
  offline?: boolean
  onRetry?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-card border border-danger/50 bg-danger-wash p-4 sm:flex-row sm:items-center sm:gap-4 md:p-5"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-control border border-danger/25 bg-surface text-danger"
      >
        {offline ? <WifiOff size={18} /> : <AlertTriangle size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-h3 text-ink">{offline ? 'No connection' : title}</p>
        <p className="mt-0.5 text-body-sm text-ink-secondary">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  )
}

/**
 * For a whole surface outside the current role's scope.
 *
 * Individual admin controls are omitted rather than disabled — a disabled
 * button is a promise you cannot keep. Server-side authorization remains the
 * real boundary; this is only what the person sees.
 */
export function PermissionDenied({ what }: { what: string }) {
  return (
    <EmptyState
      icon={Lock}
      title="Not available on your account"
      description={`${what} is managed by an organisation admin. Ask one if you need access.`}
    />
  )
}
